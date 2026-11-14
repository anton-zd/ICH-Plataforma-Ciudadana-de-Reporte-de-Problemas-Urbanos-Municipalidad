import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

async function medirEtapa<T>(nombre: string, operacion: () => PromiseLike<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await operacion();
  } finally {
    console.info(`[ciudadanos-auth] ${nombre}: ${Math.round(performance.now() - inicio)}ms`);
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveAuthPassword(secret: string, dni: string, pin: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${dni}:${pin}`));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') return response({ error: 'Método no permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const pinPepper = Deno.env.get('CITIZEN_PIN_PEPPER');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pinPepper) {
    console.error('Faltan secretos requeridos para ciudadanos-auth.');
    return response({ error: 'El servicio de autenticación no está configurado.' }, 500);
  }

  let body: { action?: string; dni?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return response({ error: 'La solicitud no contiene JSON válido.' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return response({ error: 'La solicitud no contiene datos válidos.' }, 400);
  }

  const dni = body.dni || '';
  const pin = body.pin || '';
  if (!/^\d{8}$/.test(dni) || !/^\d{4}$/.test(pin)) {
    return response({ error: 'Ingresa un DNI de 8 dígitos y un PIN de 4 dígitos.' }, 400);
  }
  if (body.action !== 'login' && body.action !== 'register') {
    return response({ error: 'Acción de autenticación no válida.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const ip = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  const rateKey = await hmacHex(pinPepper, `${dni}:${ip}`);

  if (body.action === 'register') {
    const { data: existing, error: lookupError } = await admin
      .from('ciudadanos')
      .select('dni')
      .eq('dni', dni)
      .maybeSingle();
    if (lookupError) {
      console.error('No se pudo comprobar el registro ciudadano:', lookupError.message);
      return response({ error: 'No se pudo completar el registro.' }, 500);
    }
    if (existing) return response({ error: 'Ya existe una cuenta con ese DNI.' }, 409);

    const email = `${dni}@ciudadanos.serenazgo.invalid`;
    const authPassword = await deriveAuthPassword(pinPepper, dni, pin);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: authPassword,
      email_confirm: true,
      app_metadata: { role: 'ciudadano', dni }
    });
    if (createError || !created.user) {
      console.error('No se pudo crear la cuenta Auth ciudadana:', createError?.message);
      return response({ error: 'No se pudo crear la cuenta. Verifica los datos e inténtalo nuevamente.' }, 400);
    }

    const { error: profileError } = await admin
      .from('ciudadanos')
      .insert({ dni, auth_user_id: created.user.id });
    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
      if (cleanupError) {
        console.error('No se pudo revertir la cuenta Auth incompleta:', cleanupError.message);
      }
      console.error('No se pudo guardar el perfil ciudadano:', profileError.message);
      return response({ error: 'No se pudo completar el registro.' }, 500);
    }
  }

  const { data: canAttempt, error: rateError } = await medirEtapa(
    'rate-limit-check',
    () => admin.rpc('ciudadano_login_permitido', { p_key_hash: rateKey })
  );
  if (rateError) {
    console.error('No se pudo comprobar el límite de intentos:', rateError.message);
    return response({ error: 'No se pudo validar el acceso.' }, 500);
  }
  if (!canAttempt) {
    return response({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' }, 429);
  }

  const { data: citizen, error: citizenError } = await medirEtapa(
    'citizen-lookup',
    () => admin.from('ciudadanos').select('dni').eq('dni', dni).maybeSingle()
  );
  if (citizenError) {
    console.error('No se pudo buscar la cuenta ciudadana:', citizenError.message);
    return response({ error: 'No se pudo validar el acceso.' }, 500);
  }
  if (!citizen) {
    const { error: attemptError } = await medirEtapa(
      'record-failed-attempt',
      () => admin.rpc('registrar_fallo_login_ciudadano', { p_key_hash: rateKey })
    );
    if (attemptError) {
      console.error('No se pudo registrar el intento de acceso:', attemptError.message);
      return response({ error: 'No se pudo validar el acceso.' }, 500);
    }
    return response({ error: 'DNI o PIN incorrectos.' }, 401);
  }

  const email = `${dni}@ciudadanos.serenazgo.invalid`;
  const authPassword = await deriveAuthPassword(pinPepper, dni, pin);
  const { data: signedIn, error: signInError } = await medirEtapa(
    'supabase-auth-sign-in',
    () => authClient.auth.signInWithPassword({ email, password: authPassword })
  );
  if (signInError || !signedIn.session) {
    const { error: attemptError } = await medirEtapa(
      'record-failed-attempt',
      () => admin.rpc('registrar_fallo_login_ciudadano', { p_key_hash: rateKey })
    );
    if (attemptError) {
      console.error('No se pudo registrar el intento de acceso:', attemptError.message);
      return response({ error: 'No se pudo validar el acceso.' }, 500);
    }
    return response({ error: 'DNI o PIN incorrectos.' }, 401);
  }

  const { error: clearError } = await medirEtapa(
    'clear-failed-attempts',
    () => admin.rpc('limpiar_fallos_login_ciudadano', { p_key_hash: rateKey })
  );
  if (clearError) {
    console.error('No se pudo reiniciar el límite de intentos:', clearError.message);
    return response({ error: 'No se pudo completar el acceso.' }, 500);
  }
  return response({
    session: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token
    }
  });
});
