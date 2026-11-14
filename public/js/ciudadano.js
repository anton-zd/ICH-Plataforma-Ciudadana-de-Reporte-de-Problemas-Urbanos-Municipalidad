/**
 * public/js/ciudadano.js
 * Lógica Frontend del Rol Ciudadano — Sistema Inclusivo de Atención de Serenazgo
 * Flujo Mobile-First en 3 Pasos, persistencia de reportes en Supabase
 * Cumplimiento con estándar de accesibilidad WCAG 2.1 AA
 */

'use strict';

const supabaseUrl = 'https://nazqgqiyluoqytgwyoga.supabase.co';
const supabaseKey = 'sb_publishable_CdzSpjn1Me7fxnKJ7VOCzQ_tWzoLYVu';
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'serenazgo-ciudadano-auth' }
  })
  : null;

let fotoBase64 = null;
let audioBase64 = null;
let audioVozBase64 = null;
let audioEvidenceBase64 = null;
let fotoDataUrlPromise = Promise.resolve(true);
let audioVozDataUrlPromise = Promise.resolve(true);
let audioEvidenceDataUrlPromise = Promise.resolve(true);

// ─── Estado Local del Ciudadano ──────────────────────────────────────────────
const state = {
  pasoActual: 0, // 0: home, 1: tipo, 2: ubicacion, 3: resumen
  tipoSeleccionado: null,
  lat: -12.1611, // Coordenadas centrales de Chorrillos por defecto
  lng: -77.0210,
  gpsObtenido: false,
  modoSeleccionManual: false,
  referenciaTexto: '',
  audioBlob: null,
  audioVozUrl: null,
  mediaRecorderVoz: null,
  audioVozStream: null,
  audioEvidenceBlob: null,
  audioEvidenceUrl: null,
  mediaRecorderEvidencia: null,
  audioEvidenceStream: null,
  fotoBlob: null,
  ticketActual: null,
  dniActual: null,
  mapaObj: null,
  markerObj: null,
  grabandoVoz: false,
  grabandoEvidencia: false,
  envioEnCurso: false,
  pollingSeguimiento: null,
};

// Catálogo descriptivo y visual de incidentes
const CATALOGO_TIPOS = {
  violencia: {
    nombre: 'Violencia',
    icono: 'img/icon-violencia.png',
    prioridad: 1, // RN-01: Prioridad Alta
    descVoz: 'Violencia. Selecciona esta opción en caso de agresión física, violencia familiar o riña en la vía pública.'
  },
  robo: {
    nombre: 'Robo',
    icono: 'img/icon-robo.png',
    prioridad: 2,
    descVoz: 'Robo. Selecciona esta opción si eres víctima o testigo de un asalto, hurto o robo a vivienda.'
  },
  accidente: {
    nombre: 'Accidente',
    icono: 'img/icon-accidente.png',
    prioridad: 2,
    descVoz: 'Accidente. Selecciona esta opción para choques vehiculares, atropellos o emergencias en pistas.'
  },
  auxilio: {
    nombre: 'Auxilio',
    icono: 'img/icon-auxilio.png',
    prioridad: 1, // RN-01: Prioridad Alta
    descVoz: 'Auxilio. Selecciona esta opción para urgencias médicas, desvanecimiento o auxilio a personas en riesgo.'
  },
  otros: {
    nombre: 'Otros',
    icono: 'img/icon-otros.png',
    prioridad: 2,
    descVoz: 'Otros. Selecciona esta opción para situaciones no contempladas en las categorías anteriores.'
  }
};

function leerArchivoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader no devolvió una URL de datos.'));
      }
    });
    reader.addEventListener('error', () => {
      reject(reader.error || new Error('No se pudo leer el archivo.'));
    });
    reader.readAsDataURL(file);
  });
}

function actualizarAudioBase64() {
  audioBase64 = audioEvidenceBase64 || audioVozBase64;
}

// ─── Control de Pantallas y Pasos (UI Mobile First) ──────────────────────────

/**
 * Muestra la pantalla solicitada y oculta las demás.
 * Gestiona el indicador de pasos superior.
 */
function mostrarPantalla(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-hidden', 'true');
  });

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    target.removeAttribute('aria-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Actualizar indicador de pasos
  const stepIndicator = document.getElementById('step-indicator');
  const pasoMap = {
    'screen-tipo': 1,
    'screen-ubicacion': 2,
    'screen-resumen': 3
  };

  const pasoActual = pasoMap[screenId];
  if (pasoActual && stepIndicator) {
    stepIndicator.classList.remove('hidden');
    actualizarIndicadorPasos(pasoActual);
  } else if (stepIndicator) {
    stepIndicator.classList.add('hidden');
  }

  // Refrescar tamaño del mapa si se abre la pantalla de ubicación
  if (screenId === 'screen-ubicacion' && state.mapaObj) {
    setTimeout(() => {
      state.mapaObj.invalidateSize();
    }, 200);
  }
}

function actualizarIndicadorPasos(paso) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`step-${i}`);
    if (!dot) continue;
    dot.className = 'flex-grow-1 rounded-pill ';
    if (i < paso) {
      dot.className += 'bg-success';
    } else if (i === paso) {
      dot.className += 'bg-primary';
    } else {
      dot.className += 'bg-secondary opacity-25';
    }
  }
}

/**
 * Notificaciones flotantes tipo Toast accesibles
 */
function showToast(mensaje, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const icono = tipo === 'success' ? '✅' : tipo === 'error' ? '❌' : 'ℹ️';
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = icono;
  const text = document.createElement('span');
  text.textContent = mensaje;
  toast.append(icon, text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

/**
 * Síntesis de voz auditiva (Text-To-Speech) para accesibilidad (RF-02)
 */
function hablarTexto(texto) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel(); // Detener audios previos
  const mensaje = new SpeechSynthesisUtterance(texto);
  mensaje.lang = 'es-PE';
  mensaje.rate = 0.95;
  window.speechSynthesis.speak(mensaje);
}

/**
 * Vibración háptica en dispositivos compatibles
 */
function vibrar(patron = [60]) {
  if ('vibrate' in navigator) {
    navigator.vibrate(patron);
  }
}

async function autenticarCiudadano(action, mensajeExito) {
  const dniInput = document.getElementById('ciudadano-dni');
  const pinInput = document.getElementById('ciudadano-pin');
  const errorEl = document.getElementById('ciudadano-login-error');
  const loginButton = document.getElementById('btn-login-ciudadano');
  const registerButton = document.getElementById('btn-registro-ciudadano');
  const dni = dniInput?.value.trim() || '';
  const pin = pinInput?.value || '';

  if (!/^\d{8}$/.test(dni) || !/^\d{4}$/.test(pin)) {
    if (errorEl) {
      errorEl.textContent = 'Ingresa un DNI de 8 dígitos y un PIN de 4 dígitos.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  if (errorEl) errorEl.classList.add('hidden');
  if (loginButton) loginButton.disabled = true;
  if (registerButton) registerButton.disabled = true;

  try {
    if (!supabaseClient) {
      throw new Error('No se pudo cargar la librería cliente de Supabase.');
    }
    const { data, error } = await supabaseClient.functions.invoke('ciudadanos-auth', {
      body: { action, dni, pin }
    });
    if (error) throw new Error(data?.error || error.message || 'No se pudo validar el acceso.');
    if (data?.error) throw new Error(data.error);

    const { error: sessionError } = await supabaseClient.auth.setSession(data.session);
    if (sessionError) throw sessionError;

    state.dniActual = dni;
    mostrarPantalla('screen-home');
    document.getElementById('btn-ir-seguimiento')?.classList.remove('hidden');
    showToast(mensajeExito, 'success');
  } catch (error) {
    console.error('Error de acceso ciudadano:', error);
    if (errorEl) {
      errorEl.textContent = error.message || 'No se pudo validar el acceso.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    if (loginButton) loginButton.disabled = false;
    if (registerButton) registerButton.disabled = false;
  }
}

// ─── Geolocalización y Mapa Leaflet (RF-01) ──────────────────────────────────

function actualizarTextoUbicacion(mensaje) {
  const textEl = document.getElementById('location-text');
  if (textEl) textEl.textContent = mensaje;
}

function actualizarCoordenadas(lat, lng, centrar = false) {
  state.lat = lat;
  state.lng = lng;

  if (state.markerObj) state.markerObj.setLatLng([lat, lng]);
  if (centrar && state.mapaObj) state.mapaObj.setView([lat, lng], 16);

  actualizarTextoUbicacion(`Ubicación seleccionada: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  const btnContinuar = document.getElementById('btn-continuar-ubicacion');
  if (btnContinuar) btnContinuar.disabled = false;
}

function obtenerUbicacionActual() {
  if (!navigator.geolocation) {
    const mensaje = 'No se pudo obtener la ubicación. Verifica los permisos de tu navegador o usa la selección manual.';
    actualizarTextoUbicacion(mensaje);
    alert(mensaje);
    return;
  }

  actualizarTextoUbicacion('Solicitando ubicación actual…');
  const opcionesGPS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      state.gpsObtenido = true;
      state.modoSeleccionManual = false;
      if (!state.mapaObj) montarMapaLeaflet(lat, lng);
      state.mapaObj.setView([lat, lng], 16);
      state.markerObj.setLatLng([lat, lng]);
      state.lat = lat;
      state.lng = lng;
      const btnContinuar = document.getElementById('btn-continuar-ubicacion');
      if (btnContinuar) btnContinuar.disabled = false;
      actualizarTextoUbicacion(`Ubicación GPS obtenida: ${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`);
      const btnManual = document.getElementById('btn-gps-manual');
      if (btnManual) {
        btnManual.classList.remove('active');
        btnManual.setAttribute('aria-pressed', 'false');
      }
    },
    (err) => {
      console.warn('No se pudo obtener la ubicación GPS:', err.message);
      const mensaje = 'No se pudo obtener la ubicación. Verifica los permisos de tu navegador o usa la selección manual.';
      actualizarTextoUbicacion(mensaje);
      alert(mensaje);
    },
    opcionesGPS
  );
}

function montarMapaLeaflet(lat, lng) {
  const container = document.getElementById('mapa-ciudadano');
  if (!container) return;

  if (state.mapaObj) {
    state.mapaObj.setView([lat, lng], 16);
    if (state.markerObj) state.markerObj.setLatLng([lat, lng]);
    setTimeout(() => state.mapaObj.invalidateSize(), 100);
    return;
  }

  state.mapaObj = L.map('mapa-ciudadano', {
    zoomControl: true,
    attributionControl: true
  }).setView([lat, lng], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.mapaObj);

  state.markerObj = L.marker([lat, lng], {
    draggable: true,
    title: 'Arrastra para precisar tu ubicación'
  }).addTo(state.mapaObj);

  state.mapaObj.on('click', (event) => {
    if (!state.modoSeleccionManual) return;
    actualizarCoordenadas(event.latlng.lat, event.latlng.lng);
    state.modoSeleccionManual = false;
    const btnManual = document.getElementById('btn-gps-manual');
    if (btnManual) {
      btnManual.classList.remove('active');
      btnManual.setAttribute('aria-pressed', 'false');
    }
    showToast('Ubicación seleccionada en el mapa', 'success');
  });

  state.markerObj.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    actualizarCoordenadas(pos.lat, pos.lng);
    showToast('Ubicación ajustada en el mapa', 'info');
  });

  setTimeout(() => state.mapaObj.invalidateSize(), 100);
}

// ─── Grabación de Notas de Voz de Referencia (RF-01, RF-03) ──────────────────

async function alternarGrabacionVoz() {
  const btn = document.getElementById('btn-grabar-voz');
  const buttons = document.getElementById('botones-referencia-paso2');
  const indicator = document.getElementById('recording-indicator-paso2');
  const previewContainer = document.getElementById('audio-preview-container-paso2');
  const audioPreview = document.getElementById('audio-preview-paso2');
  if (!btn || !buttons || !indicator || !previewContainer || !audioPreview) return;

  if (state.grabandoVoz) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>Procesando audio…</span>';
    indicator.classList.remove('active');
    if (state.mediaRecorderVoz?.state === 'recording') {
      state.mediaRecorderVoz.stop();
    }
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('La grabación de audio no está disponible en este navegador.', 'error');
    return;
  }

  let stream;
  try {
    state.grabandoVoz = true;
    btn.disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const opciones = typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported('audio/webm')
      ? { mimeType: 'audio/webm' }
      : undefined;
    const recorder = opciones
      ? new MediaRecorder(stream, opciones)
      : new MediaRecorder(stream);

    state.audioVozStream = stream;
    state.mediaRecorderVoz = recorder;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      state.grabandoVoz = false;
      state.audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (state.audioVozUrl) URL.revokeObjectURL(state.audioVozUrl);
      state.audioVozUrl = URL.createObjectURL(state.audioBlob);
      audioPreview.src = state.audioVozUrl;
      const grabacion = state.audioBlob;
      audioVozDataUrlPromise = leerArchivoComoDataURL(grabacion).then((dataUrl) => {
        if (state.audioBlob === grabacion) {
          audioVozBase64 = dataUrl;
          actualizarAudioBase64();
        }
        return true;
      }).catch((error) => {
        console.error('No se pudo convertir la nota de voz:', error);
        showToast('No se pudo preparar la nota de voz para adjuntarla.', 'error');
        return false;
      });
      buttons.classList.add('hidden');
      previewContainer.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-mic-fill text-danger"></i> <span>Grabar Voz</span>';
      stream.getTracks().forEach(track => track.stop());
      state.audioVozStream = null;
      state.mediaRecorderVoz = null;
      showToast('Nota de voz lista para escuchar.', 'success');
    });

    recorder.start();
    btn.disabled = false;
    indicator.classList.add('active');
    btn.innerHTML = '<i class="bi bi-stop-circle-fill text-danger"></i> <span>Detener</span>';
    vibrar([50]);
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    state.audioVozStream = null;
    state.mediaRecorderVoz = null;
    state.grabandoVoz = false;
    btn.disabled = false;
    console.error('No se pudo iniciar la grabación de referencia:', error);
    showToast('No se pudo acceder al micrófono para la nota de voz.', 'error');
  }
}

function borrarGrabacionVoz() {
  const buttons = document.getElementById('botones-referencia-paso2');
  const indicator = document.getElementById('recording-indicator-paso2');
  const previewContainer = document.getElementById('audio-preview-container-paso2');
  const audioPreview = document.getElementById('audio-preview-paso2');

  if (state.mediaRecorderVoz?.state === 'recording') {
    state.mediaRecorderVoz.stop();
  }
  if (state.audioVozStream) {
    state.audioVozStream.getTracks().forEach(track => track.stop());
    state.audioVozStream = null;
  }
  if (state.audioVozUrl) {
    URL.revokeObjectURL(state.audioVozUrl);
    state.audioVozUrl = null;
  }
  state.audioBlob = null;
  audioVozBase64 = null;
  actualizarAudioBase64();
  audioVozDataUrlPromise = Promise.resolve(true);
  state.mediaRecorderVoz = null;
  state.grabandoVoz = false;

  if (audioPreview) {
    audioPreview.pause();
    audioPreview.removeAttribute('src');
    audioPreview.load();
  }
  if (indicator) indicator.classList.remove('active');
  if (previewContainer) previewContainer.classList.add('hidden');
  if (buttons) buttons.classList.remove('hidden');
  const btn = document.getElementById('btn-grabar-voz');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-mic-fill text-danger"></i> <span>Grabar Voz</span>';
  }
}

// ─── Grabación de audio de evidencia (Paso 3) ────────────────────────────────

async function alternarGrabacionEvidencia() {
  const btn = document.getElementById('btn-grabar-evidencia');
  const previewContainer = document.getElementById('audio-preview-container');
  const audioPreview = document.getElementById('audio-preview');
  if (!btn || !previewContainer || !audioPreview) return;

  if (state.grabandoEvidencia) {
    if (state.mediaRecorderEvidencia?.state === 'recording') {
      state.mediaRecorderEvidencia.stop();
    }
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('La grabación de audio no está disponible en este navegador.', 'error');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const opciones = typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported('audio/webm')
      ? { mimeType: 'audio/webm' }
      : undefined;
    const recorder = opciones
      ? new MediaRecorder(stream, opciones)
      : new MediaRecorder(stream);

    state.audioEvidenceStream = stream;
    state.mediaRecorderEvidencia = recorder;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      state.grabandoEvidencia = false;
      state.audioEvidenceBlob = new Blob(chunks, {
        type: recorder.mimeType || 'audio/webm'
      });
      state.audioEvidenceUrl = URL.createObjectURL(state.audioEvidenceBlob);
      audioPreview.src = state.audioEvidenceUrl;
      const grabacion = state.audioEvidenceBlob;
      audioEvidenceDataUrlPromise = leerArchivoComoDataURL(grabacion).then((dataUrl) => {
        if (state.audioEvidenceBlob === grabacion) {
          audioEvidenceBase64 = dataUrl;
          actualizarAudioBase64();
        }
        return true;
      }).catch((error) => {
        console.error('No se pudo convertir el audio de evidencia:', error);
        showToast('No se pudo preparar el audio para adjuntarlo.', 'error');
        return false;
      });
      previewContainer.classList.remove('hidden');
      btn.classList.add('hidden');
      btn.classList.remove('recording');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = '<i class="bi bi-soundwave text-danger fs-5"></i><span class="fw-semibold small">Grabar audio de lo ocurrido</span>';
      stream.getTracks().forEach(track => track.stop());
      state.audioEvidenceStream = null;
      state.mediaRecorderEvidencia = null;
      showToast('Grabación de evidencia lista para escuchar.', 'success');
    });

    recorder.start();
    state.grabandoEvidencia = true;
    btn.classList.add('recording');
    btn.setAttribute('aria-pressed', 'true');
    btn.innerHTML = '<i class="bi bi-stop-circle-fill fs-5"></i><span class="fw-semibold small">Detener grabación</span>';
    showToast('Grabando audio de evidencia. Toca para detener.', 'info');
  } catch (error) {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    state.audioEvidenceStream = null;
    state.mediaRecorderEvidencia = null;
    state.grabandoEvidencia = false;
    console.error('No se pudo iniciar la grabación de evidencia:', error);
    showToast('No se pudo acceder al micrófono. Verifica los permisos del navegador.', 'error');
  }
}

function borrarGrabacionEvidencia() {
  const btn = document.getElementById('btn-grabar-evidencia');
  const previewContainer = document.getElementById('audio-preview-container');
  const audioPreview = document.getElementById('audio-preview');

  if (state.mediaRecorderEvidencia?.state === 'recording') {
    state.mediaRecorderEvidencia.stop();
  }
  if (state.audioEvidenceStream) {
    state.audioEvidenceStream.getTracks().forEach(track => track.stop());
    state.audioEvidenceStream = null;
  }
  if (state.audioEvidenceUrl) {
    URL.revokeObjectURL(state.audioEvidenceUrl);
    state.audioEvidenceUrl = null;
  }

  state.audioEvidenceBlob = null;
  audioEvidenceBase64 = null;
  actualizarAudioBase64();
  audioEvidenceDataUrlPromise = Promise.resolve(true);
  state.mediaRecorderEvidencia = null;
  state.grabandoEvidencia = false;
  if (audioPreview) {
    audioPreview.pause();
    audioPreview.removeAttribute('src');
    audioPreview.load();
  }
  if (previewContainer) previewContainer.classList.add('hidden');
  if (btn) {
    btn.classList.remove('hidden', 'recording');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<i class="bi bi-soundwave text-danger fs-5"></i><span class="fw-semibold small">Grabar audio de lo ocurrido</span>';
  }
}

// ─── Enviar Reporte de Emergencia a Supabase ─────────────────────────────────

async function procesarEnvioReporte() {
  if (state.envioEnCurso) return;
  if (state.grabandoVoz || state.grabandoEvidencia) {
    showToast('Detén las grabaciones de audio antes de enviar el reporte.', 'error');
    return;
  }

  const btn = document.getElementById('btn-enviar-reporte');
  state.envioEnCurso = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span> Despachando emergencia…';
  }

  try {
    const conversionesCorrectas = await Promise.all([
      fotoDataUrlPromise,
      audioVozDataUrlPromise,
      audioEvidenceDataUrlPromise
    ]);
    if (conversionesCorrectas.includes(false)) {
      throw new Error('No se pudieron preparar todas las evidencias. Vuelve a adjuntarlas antes de enviar.');
    }
    if (!supabaseClient) {
      throw new Error('No se pudo conectar con Supabase para enviar el reporte.');
    }

    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    if (authError) throw authError;
    const ciudadanoDni = state.dniActual || authData.user?.app_metadata?.dni;
    if (!ciudadanoDni || authData.user?.app_metadata?.role !== 'ciudadano') {
      throw new Error('Tu sesión ciudadana venció. Inicia sesión nuevamente antes de enviar.');
    }
    if (!Number.isFinite(state.lat) || !Number.isFinite(state.lng)) {
      throw new Error('Confirma una ubicación válida antes de enviar el reporte.');
    }

    const tipo = CATALOGO_TIPOS[state.tipoSeleccionado] ? state.tipoSeleccionado : 'auxilio';
    const infoTipo = CATALOGO_TIPOS[tipo];
    const inputReferencia = document.getElementById('ref-texto');
    state.referenciaTexto = inputReferencia?.value.trim() || state.referenciaTexto.trim();
    const nuevoIncidente = {
      ciudadano_dni: ciudadanoDni,
      tipo,
      prioridad: infoTipo.prioridad,
      ubicacion: {
        lat: state.lat,
        lng: state.lng,
        direccionAprox: 'Distrito de Chorrillos, Lima'
      },
      referencia: state.referenciaTexto,
      tiene_audio: !!(state.audioBlob || state.audioEvidenceBlob),
      tiene_audio_evidencia: !!state.audioEvidenceBlob,
      tiene_foto: !!state.fotoBlob,
      foto: fotoBase64,
      audio: audioBase64,
      audio_referencia: audioVozBase64,
      audio_evidencia: audioEvidenceBase64,
      estado: 'recibido',
      unidad_asignada: null,
      unidad: null,
      unidad_codigo: null,
      eta_minutos: null,
      observaciones: ''
    };

    const { data, error } = await supabaseClient
      .from('incidentes')
      .insert([nuevoIncidente])
      .select('ticket')
      .single();
    if (error) throw error;
    if (!data?.ticket) throw new Error('Supabase no devolvió el ticket del nuevo incidente.');
    state.ticketActual = data.ticket;
    state.dniActual = ciudadanoDni;

    const ticketNumeroEl = document.getElementById('ticket-numero');
    if (ticketNumeroEl) ticketNumeroEl.textContent = state.ticketActual;
    mostrarPantalla('screen-success');
    vibrar([100, 60, 200]);
    hablarTexto('¡Serenazgo en camino! Tu solicitud ha sido recibida con el código ' + state.ticketActual);
  } catch (error) {
    console.error('No se pudo guardar el reporte en Supabase:', error);
    alert('No se pudo enviar el reporte. Verifica tu conexión y vuelve a intentarlo.');
  } finally {
    state.envioEnCurso = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-fill-exclamation me-1"></i> ENVIAR REPORTE';
    }
  }
}

// ─── Seguimiento en Tiempo Real (RF-04, RF-05) ───────────────────────────────

async function consultarEstadoTicket(codigoTicket, notificarNoEncontrado = false) {
  if (!codigoTicket) return;
  if (!supabaseClient) {
    if (notificarNoEncontrado) showToast('No se pudo conectar con Supabase para consultar el seguimiento.', 'error');
    return;
  }
  const { data: incidente, error } = await supabaseClient
    .from('incidentes')
    .select()
    .eq('ticket', codigoTicket.trim().toUpperCase())
    .single();
  if (error) {
    console.error('No se pudo consultar el seguimiento:', error);
    if (notificarNoEncontrado) {
      showToast(error.code === 'PGRST116'
        ? `El ticket ${codigoTicket} no fue encontrado`
        : 'No se pudo consultar el estado. Inténtalo nuevamente.', 'error');
    }
    return;
  }

  // Actualizar Badge de Estado
  const badgeEstado = document.getElementById('badge-estado');
  if (badgeEstado) {
    badgeEstado.className = `badge-status badge-${incidente.estado}`;
    badgeEstado.textContent = incidente.estado.replace('_', ' ').toUpperCase();
  }

  // Actualizar Stepper Visual (Recibido -> Asignado -> En camino -> Atendido)
  const etapas = ['recibido', 'asignado', 'en_camino', 'atendido'];
  const indiceActual = etapas.indexOf(incidente.estado);

  document.querySelectorAll('.timeline-step-item').forEach(stepItem => {
    const estadoStep = stepItem.getAttribute('data-estado');
    const idxStep = etapas.indexOf(estadoStep);

    stepItem.classList.remove('done', 'active');
    if (idxStep < indiceActual) {
      stepItem.classList.add('done');
    } else if (idxStep === indiceActual) {
      stepItem.classList.add('active');
    }
  });

  // Mostrar datos de patrulla asignada si ya fue despachada por operador (RF-05)
  const panelPatrulla = document.getElementById('info-unidad-panel');
  if (panelPatrulla) {
    if (incidente.unidad || incidente.unidad_codigo) {
      panelPatrulla.classList.remove('hidden');
      const nombreEl = document.getElementById('unidad-nombre');
      const codigoEl = document.getElementById('unidad-codigo');
      const etaEl = document.getElementById('eta-valor');

      if (nombreEl) nombreEl.textContent = incidente.unidad || 'Patrulla Asignada';
      if (codigoEl) codigoEl.textContent = incidente.unidad_codigo ? `Código: ${incidente.unidad_codigo}` : 'Serenazgo Chorrillos';
      if (etaEl) etaEl.textContent = incidente.eta_minutos || '3';
    } else {
      panelPatrulla.classList.add('hidden');
    }
  }
}

function activarMonitoreoSeguimiento(ticket) {
  if (state.pollingSeguimiento) {
    clearInterval(state.pollingSeguimiento);
  }
  consultarEstadoTicket(ticket, true);

  // Polling cada 2 segundos para reflejar cambios del Operador o Serenazgo casi en vivo
  state.pollingSeguimiento = setInterval(() => {
    consultarEstadoTicket(ticket);
  }, 2000);
}

// ─── Inicialización de Eventos del DOM ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  const dniInput = document.getElementById('ciudadano-dni');
  const pinInput = document.getElementById('ciudadano-pin');
  [dniInput, pinInput].forEach((input) => {
    if (input) {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '');
      });
    }
  });

  const formLoginCiudadano = document.getElementById('form-login-ciudadano');
  if (formLoginCiudadano) {
    formLoginCiudadano.addEventListener('submit', (event) => {
      event.preventDefault();
      autenticarCiudadano('login', 'Acceso correcto. Ya puedes reportar.');
    });
  }

  document.getElementById('btn-registro-ciudadano')?.addEventListener('click', () => {
    autenticarCiudadano('register', 'Cuenta creada. Ya puedes reportar.');
  });

  // 1. Botón SOS Principal (Toca para iniciar flujo de 3 pasos)
  const btnPedirAyuda = document.getElementById('btn-pedir-ayuda');
  if (btnPedirAyuda) {
    btnPedirAyuda.addEventListener('click', () => {
      vibrar([40]);
      mostrarPantalla('screen-tipo');
    });
  }

  // 2. Selección de Tipo de Emergencia (Paso 1)
  document.querySelectorAll('.tipo-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tipo-audio-btn')) return; // No disparar si tocan el botón de audio
      const tipo = card.getAttribute('data-tipo');
      seleccionarTipoEmergencia(tipo);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const tipo = card.getAttribute('data-tipo');
        seleccionarTipoEmergencia(tipo);
      }
    });
  });

  function seleccionarTipoEmergencia(tipo) {
    if (!CATALOGO_TIPOS[tipo]) return;
    state.tipoSeleccionado = tipo;
    state.modoSeleccionManual = false;
    const btnManual = document.getElementById('btn-gps-manual');
    if (btnManual) {
      btnManual.classList.remove('active');
      btnManual.setAttribute('aria-pressed', 'false');
    }
    vibrar([30]);

    mostrarPantalla('screen-ubicacion');
    actualizarTextoUbicacion('Puedes usar el GPS o seleccionar un punto en el mapa.');
    const btnContinuar = document.getElementById('btn-continuar-ubicacion');
    if (btnContinuar) btnContinuar.disabled = true;
    setTimeout(() => montarMapaLeaflet(state.lat, state.lng), 100);
  }

  const btnUsarGps = document.getElementById('btn-gps-actual');
  if (btnUsarGps) btnUsarGps.addEventListener('click', obtenerUbicacionActual);

  const btnSeleccionarMapa = document.getElementById('btn-gps-manual');
  if (btnSeleccionarMapa) {
    btnSeleccionarMapa.addEventListener('click', () => {
      state.modoSeleccionManual = true;
      btnSeleccionarMapa.classList.add('active');
      btnSeleccionarMapa.setAttribute('aria-pressed', 'true');
      actualizarTextoUbicacion('Toca el punto deseado en el mapa para fijar la ubicación.');
      if (state.mapaObj) {
        state.mapaObj.invalidateSize();
        document.getElementById('mapa-ciudadano')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  // Botones de audio descripción (TTS)
  document.querySelectorAll('.tipo-audio-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tipo = btn.getAttribute('data-audio');
      const info = CATALOGO_TIPOS[tipo];
      if (info) {
        hablarTexto(info.descVoz);
      }
    });
  });

  // 3. Botones de Retorno (Volver Atrás)
  const volverTipo = document.getElementById('btn-volver-tipo');
  if (volverTipo) volverTipo.addEventListener('click', () => mostrarPantalla('screen-home'));

  const volverUbi = document.getElementById('btn-volver-ubicacion');
  if (volverUbi) volverUbi.addEventListener('click', () => mostrarPantalla('screen-tipo'));

  const volverRes = document.getElementById('btn-volver-resumen');
  if (volverRes) volverRes.addEventListener('click', () => mostrarPantalla('screen-ubicacion'));

  const volverSeg = document.getElementById('btn-volver-seguimiento');
  if (volverSeg) {
    volverSeg.addEventListener('click', () => {
      if (state.pollingSeguimiento) clearInterval(state.pollingSeguimiento);
      mostrarPantalla('screen-home');
    });
  }

  // 4. Paso 2 -> Paso 3 (Continuar a Resumen)
  const btnContinuarUbicacion = document.getElementById('btn-continuar-ubicacion');
  if (btnContinuarUbicacion) {
    btnContinuarUbicacion.addEventListener('click', () => {
      if (state.grabandoVoz) {
        showToast('Detén la grabación de referencia antes de continuar.', 'error');
        return;
      }

      const info = CATALOGO_TIPOS[state.tipoSeleccionado] || CATALOGO_TIPOS.auxilio;

      const resIcon = document.getElementById('resumen-icon');
      const resNombre = document.getElementById('resumen-tipo-nombre');
      const resUbicacion = document.getElementById('resumen-ubicacion-txt');
      const resRef = document.getElementById('resumen-ref-txt');

      if (resIcon) {
        resIcon.src = info.icono;
        resIcon.alt = info.nombre;
      }
      if (resNombre) resNombre.textContent = info.nombre;
      if (resUbicacion) resUbicacion.textContent = `📍 Coordenadas: ${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}`;
      if (resRef) {
        resRef.textContent = state.referenciaTexto ? `Nota: "${state.referenciaTexto}"` : '';
      }

      mostrarPantalla('screen-resumen');
    });
  }

  // 5. Referencia por Voz y Texto (Paso 2)
  const btnVoz = document.getElementById('btn-grabar-voz');
  if (btnVoz) btnVoz.addEventListener('click', alternarGrabacionVoz);

  const btnBorrarAudioPaso2 = document.getElementById('btn-borrar-audio-paso2');
  if (btnBorrarAudioPaso2) {
    btnBorrarAudioPaso2.addEventListener('click', borrarGrabacionVoz);
  }

  const btnRefTexto = document.getElementById('btn-ref-texto');
  const containerRefTexto = document.getElementById('ref-texto-container');
  const inputRefTexto = document.getElementById('ref-texto');

  if (btnRefTexto && containerRefTexto) {
    btnRefTexto.addEventListener('click', () => {
      containerRefTexto.classList.remove('hidden', 'd-none');
      if (inputRefTexto) inputRefTexto.focus();
    });
  }

  if (inputRefTexto) {
    inputRefTexto.addEventListener('input', (e) => {
      state.referenciaTexto = e.target.value;
    });
  }

  // 6. Evidencia Fotográfica y Sonora (Paso 3)
  const inputFoto = document.getElementById('evidencia-foto');
  const previewFoto = document.getElementById('preview-foto');
  const labelFoto = document.getElementById('foto-label-text');

  if (inputFoto) {
    inputFoto.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        state.fotoBlob = file;
        fotoBase64 = null;
        if (labelFoto) labelFoto.textContent = `Foto: ${file.name.substring(0, 18)}...`;
        fotoDataUrlPromise = leerArchivoComoDataURL(file).then((dataUrl) => {
          if (state.fotoBlob === file) {
            fotoBase64 = dataUrl;
            if (previewFoto) {
              previewFoto.src = dataUrl;
              previewFoto.classList.remove('d-none');
            }
            showToast('Fotografía adjuntada', 'success');
          }
          return true;
        }).catch((error) => {
          console.error('No se pudo convertir la fotografía:', error);
          showToast('No se pudo leer la fotografía seleccionada.', 'error');
          return false;
        });
      } else {
        state.fotoBlob = null;
        fotoBase64 = null;
        fotoDataUrlPromise = Promise.resolve(true);
        if (previewFoto) {
          previewFoto.removeAttribute('src');
          previewFoto.classList.add('d-none');
        }
      }
    });
  }

  const btnGrabarEvidencia = document.getElementById('btn-grabar-evidencia');
  if (btnGrabarEvidencia) {
    btnGrabarEvidencia.addEventListener('click', alternarGrabacionEvidencia);
  }

  const btnBorrarAudio = document.getElementById('btn-borrar-audio');
  if (btnBorrarAudio) {
    btnBorrarAudio.addEventListener('click', borrarGrabacionEvidencia);
  }

  // 7. Botón Final de Despacho (ENVIAR REPORTE)
  const btnEnviar = document.getElementById('btn-enviar-reporte');
  if (btnEnviar) {
    btnEnviar.addEventListener('click', procesarEnvioReporte);
  }

  // 8. Botones de Pantalla de Éxito
  const btnVerSeg = document.getElementById('btn-ver-seguimiento');
  if (btnVerSeg) {
    btnVerSeg.addEventListener('click', () => {
      mostrarPantalla('screen-seguimiento');
      if (state.ticketActual) {
        const inputTicket = document.getElementById('input-ticket');
        if (inputTicket) inputTicket.value = state.ticketActual;
        activarMonitoreoSeguimiento(state.ticketActual);
      }
    });
  }

  const btnNuevoRep = document.getElementById('btn-nuevo-reporte');
  if (btnNuevoRep) {
    btnNuevoRep.addEventListener('click', () => {
      mostrarPantalla('screen-home');
      state.tipoSeleccionado = null;
      state.referenciaTexto = '';
      state.fotoBlob = null;
      fotoBase64 = null;
      fotoDataUrlPromise = Promise.resolve(true);
      if (inputFoto) inputFoto.value = '';
      if (previewFoto) {
        previewFoto.removeAttribute('src');
        previewFoto.classList.add('d-none');
      }
      const labelFoto = document.getElementById('foto-label-text');
      if (labelFoto) labelFoto.textContent = 'Tomar o adjuntar foto';
      borrarGrabacionVoz();
      borrarGrabacionEvidencia();
    });
  }

  // 9. Búsqueda Manual de Ticket en Pantalla de Seguimiento
  const formBuscarTicket = document.getElementById('form-buscar-ticket');
  if (formBuscarTicket) {
    formBuscarTicket.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('input-ticket');
      if (input && input.value.trim()) {
        activarMonitoreoSeguimiento(input.value.trim());
      }
    });
  }

  const btnIrSeguimiento = document.getElementById('btn-ir-seguimiento');
  if (btnIrSeguimiento) {
    btnIrSeguimiento.addEventListener('click', () => {
      mostrarPantalla('screen-seguimiento');
      const lastTicket = state.ticketActual;
      if (lastTicket) {
        const input = document.getElementById('input-ticket');
        if (input) input.value = lastTicket;
        activarMonitoreoSeguimiento(lastTicket);
      }
    });
  }

  // 10. Detección de parámetro URL desde Landing Page (ej: ?tipo=violencia)
  const urlParams = new URLSearchParams(window.location.search);
  const tipoQuery = urlParams.get('tipo');
  if (tipoQuery && CATALOGO_TIPOS[tipoQuery]) {
    setTimeout(() => {
      seleccionarTipoEmergencia(tipoQuery);
    }, 150);
  }

  if (!supabaseClient) {
    console.error('No se pudo cargar la librería cliente de Supabase.');
  } else {
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      const user = data.session?.user;
      if (user?.app_metadata?.role === 'ciudadano') {
        state.dniActual = user.app_metadata.dni;
        mostrarPantalla('screen-home');
        document.getElementById('btn-ir-seguimiento')?.classList.remove('hidden');
      }
    }).catch(error => console.error('No se pudo restaurar la sesión ciudadana:', error));
  }

  console.log('Módulo Ciudadano inicializado con persistencia Supabase.');
});