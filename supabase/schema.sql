CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.generar_ticket_incidente()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT 'INC-' || to_char(current_date, 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

CREATE TABLE IF NOT EXISTS public.ciudadanos (
  dni text PRIMARY KEY CHECK (dni ~ '^[0-9]{8}$'),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket text NOT NULL UNIQUE DEFAULT public.generar_ticket_incidente(),
  ciudadano_dni text NOT NULL REFERENCES public.ciudadanos (dni),
  tipo text NOT NULL CHECK (tipo IN ('violencia', 'robo', 'accidente', 'auxilio', 'otros')),
  prioridad smallint NOT NULL DEFAULT 2 CHECK (prioridad IN (1, 2)),
  ubicacion jsonb NOT NULL,
  referencia text NOT NULL DEFAULT '',
  descripcion_evidencia text NOT NULL DEFAULT '',
  tiene_audio boolean NOT NULL DEFAULT false,
  tiene_audio_evidencia boolean NOT NULL DEFAULT false,
  tiene_foto boolean NOT NULL DEFAULT false,
  foto text,
  audio text,
  audio_referencia text,
  audio_evidencia text,
  estado text NOT NULL DEFAULT 'recibido'
    CHECK (estado IN ('recibido', 'asignado', 'en_camino', 'atendido', 'cancelado')),
  unidad_asignada text,
  unidad text,
  unidad_codigo text,
  eta_minutos integer,
  observaciones text NOT NULL DEFAULT '',
  observaciones_ciudadano text NOT NULL DEFAULT '',
  timestamp timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  atendido_at timestamptz
);

ALTER TABLE public.incidentes
  ADD COLUMN IF NOT EXISTS descripcion_evidencia text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS observaciones_ciudadano text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.ciudadano_auth_rate_limits (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE INDEX IF NOT EXISTS incidentes_ciudadano_dni_idx ON public.incidentes (ciudadano_dni);
CREATE INDEX IF NOT EXISTS incidentes_unidad_estado_idx ON public.incidentes (unidad_asignada, estado);
CREATE UNIQUE INDEX IF NOT EXISTS incidentes_unidad_activa_idx
  ON public.incidentes (unidad_asignada)
  WHERE unidad_asignada IS NOT NULL AND estado IN ('asignado', 'en_camino');
CREATE UNIQUE INDEX IF NOT EXISTS incidentes_ciudadano_activo_idx
  ON public.incidentes (ciudadano_dni)
  WHERE estado IN ('recibido', 'asignado', 'en_camino');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'incidentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.incidentes;
  END IF;
END;
$$;

ALTER TABLE public.ciudadanos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ciudadano_auth_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ciudadanos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ciudadanos TO service_role;
REVOKE ALL ON public.ciudadano_auth_rate_limits FROM anon, authenticated;
GRANT ALL ON public.ciudadano_auth_rate_limits TO service_role;
REVOKE ALL ON public.incidentes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.incidentes TO authenticated;
GRANT INSERT (
  ciudadano_dni, tipo, prioridad, ubicacion, referencia,
  descripcion_evidencia,
  tiene_audio, tiene_audio_evidencia, tiene_foto,
  foto, audio, audio_referencia, audio_evidencia,
  estado, unidad_asignada, unidad, unidad_codigo, eta_minutos, observaciones
) ON public.incidentes TO authenticated;
GRANT UPDATE (
  estado, unidad_asignada, unidad, unidad_codigo, eta_minutos,
  observaciones, atendido_at, updated_at
) ON public.incidentes TO authenticated;

DROP POLICY IF EXISTS "citizens can read their own reports" ON public.incidentes;
DROP POLICY IF EXISTS "citizens can create their own reports" ON public.incidentes;
DROP POLICY IF EXISTS "operators can read all reports" ON public.incidentes;
DROP POLICY IF EXISTS "operators can update reports" ON public.incidentes;
DROP POLICY IF EXISTS "assigned units can read their reports" ON public.incidentes;
DROP POLICY IF EXISTS "assigned units can update their reports" ON public.incidentes;

CREATE POLICY "citizens can read their own reports"
  ON public.incidentes FOR SELECT TO authenticated
  USING (
    ciudadano_dni = (auth.jwt() -> 'app_metadata' ->> 'dni')
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'ciudadano'
  );

CREATE POLICY "citizens can create their own reports"
  ON public.incidentes FOR INSERT TO authenticated
  WITH CHECK (
    ciudadano_dni = (auth.jwt() -> 'app_metadata' ->> 'dni')
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'ciudadano'
    AND ticket ~ '^INC-[0-9]{4}-[A-F0-9]{8}$'
    AND prioridad = CASE WHEN tipo IN ('violencia', 'auxilio') THEN 1 ELSE 2 END
    AND estado = 'recibido'
    AND unidad_asignada IS NULL
    AND unidad IS NULL
    AND unidad_codigo IS NULL
    AND eta_minutos IS NULL
    AND observaciones = ''
  );

CREATE POLICY "operators can read all reports"
  ON public.incidentes FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'operador');

CREATE POLICY "operators can update reports"
  ON public.incidentes FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'operador')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'operador');

CREATE POLICY "assigned units can read their reports"
  ON public.incidentes FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'sereno'
    AND unidad_asignada = (auth.jwt() -> 'app_metadata' ->> 'unit_code')
  );

CREATE POLICY "assigned units can update their reports"
  ON public.incidentes FOR UPDATE TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'sereno'
    AND unidad_asignada = (auth.jwt() -> 'app_metadata' ->> 'unit_code')
    AND estado IN ('asignado', 'en_camino')
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'sereno'
    AND unidad_asignada = (auth.jwt() -> 'app_metadata' ->> 'unit_code')
    AND estado IN ('en_camino', 'atendido', 'cancelado')
  );

CREATE OR REPLACE FUNCTION public.proteger_edicion_incidente_sereno()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'sereno'
    AND (to_jsonb(NEW) - ARRAY['estado', 'observaciones', 'atendido_at', 'updated_at'])
      IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['estado', 'observaciones', 'atendido_at', 'updated_at'])
  THEN
    RAISE EXCEPTION 'La unidad solo puede actualizar el estado y las observaciones del incidente.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER incidentes_proteger_edicion_sereno
  BEFORE UPDATE ON public.incidentes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_edicion_incidente_sereno();

REVOKE ALL ON public.ciudadano_auth_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ciudadano_auth_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.ciudadano_login_permitido(p_key_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.ciudadano_auth_rate_limits
    WHERE key_hash = p_key_hash
      AND locked_until > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.registrar_fallo_login_ciudadano(p_key_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.ciudadano_auth_rate_limits
    (key_hash, attempts, window_started_at, locked_until)
  VALUES (p_key_hash, 1, now(), NULL)
  ON CONFLICT (key_hash) DO UPDATE
  SET attempts = CASE
        WHEN public.ciudadano_auth_rate_limits.window_started_at <= now() - interval '15 minutes'
          THEN 1
        ELSE public.ciudadano_auth_rate_limits.attempts + 1
      END,
      window_started_at = CASE
        WHEN public.ciudadano_auth_rate_limits.window_started_at <= now() - interval '15 minutes'
          THEN now()
        ELSE public.ciudadano_auth_rate_limits.window_started_at
      END,
      locked_until = CASE
        WHEN public.ciudadano_auth_rate_limits.window_started_at <= now() - interval '15 minutes'
          THEN NULL
        WHEN public.ciudadano_auth_rate_limits.attempts + 1 >= 5
          THEN now() + interval '15 minutes'
        ELSE public.ciudadano_auth_rate_limits.locked_until
      END;
END;
$$;

CREATE OR REPLACE FUNCTION public.limpiar_fallos_login_ciudadano(p_key_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  DELETE FROM public.ciudadano_auth_rate_limits WHERE key_hash = p_key_hash;
$$;

REVOKE ALL ON FUNCTION public.ciudadano_login_permitido(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_fallo_login_ciudadano(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpiar_fallos_login_ciudadano(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciudadano_login_permitido(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_fallo_login_ciudadano(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_fallos_login_ciudadano(text) TO service_role;

CREATE OR REPLACE FUNCTION public.agregar_anotacion_ciudadano(
  p_ticket text,
  p_anotacion text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_dni text := auth.jwt() -> 'app_metadata' ->> 'dni';
  v_anotacion text := btrim(COALESCE(p_anotacion, ''));
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'ciudadano'
    OR v_dni IS NULL
  THEN
    RAISE EXCEPTION 'Solo el titular del reporte puede agregar anotaciones.';
  END IF;
  IF char_length(v_anotacion) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'La anotación debe tener entre 1 y 500 caracteres.';
  END IF;

  UPDATE public.incidentes
  SET observaciones_ciudadano = concat_ws(
        E'\n',
        NULLIF(observaciones_ciudadano, ''),
        to_char(now() AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') || ' - ' || v_anotacion
      ),
      updated_at = now()
  WHERE ticket = p_ticket
    AND ciudadano_dni = v_dni
    AND estado IN ('recibido', 'asignado', 'en_camino');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_incidente_ciudadano(p_ticket text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_dni text := auth.jwt() -> 'app_metadata' ->> 'dni';
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'ciudadano'
    OR v_dni IS NULL
  THEN
    RAISE EXCEPTION 'Solo el titular del reporte puede cancelarlo.';
  END IF;

  UPDATE public.incidentes
  SET estado = 'cancelado',
      updated_at = now()
  WHERE ticket = p_ticket
    AND ciudadano_dni = v_dni
    AND estado IN ('recibido', 'asignado', 'en_camino');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.agregar_anotacion_ciudadano(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_incidente_ciudadano(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_anotacion_ciudadano(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_incidente_ciudadano(text) TO authenticated;
