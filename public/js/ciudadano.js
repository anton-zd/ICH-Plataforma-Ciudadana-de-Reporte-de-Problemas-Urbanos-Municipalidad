/**
 * public/js/ciudadano.js
 * Lógica Frontend del Rol Ciudadano — Sistema Inclusivo de Atención de Serenazgo
 * Flujo Mobile-First en 3 Pasos, persistencia de reportes en Supabase
 * Cumplimiento con estándar de accesibilidad WCAG 2.1 AA
 */

'use strict';

const supabaseUrl = 'https://lipzgvzhiznoebmzjmwi.supabase.co';
const supabaseKey = 'sb_publishable_HdsFY1neo8q0nRCp-Wog1A_ideexOdx';
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'serenazgo-ciudadano-auth' }
  })
  : null;

let fotoBase64 = null;
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
  notaEvidencia: '',
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
  ticketSeguimientoActual: null,
  dniActual: null,
  historialIncidentes: [],
  historialRealtimeChannel: null,
  historialDniSuscrito: null,
  historialCargaEnCurso: false,
  historialEventosPendientes: [],
  historialError: null,
  mapaObj: null,
  markerObj: null,
  grabandoVoz: false,
  grabandoEvidencia: false,
  envioEnCurso: false,
  consultaSeguimientoEnCurso: false,
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

function optimizarFotoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('La fotografía seleccionada no tiene dimensiones válidas.'));
        return;
      }
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('No se pudo preparar el lienzo para comprimir la fotografía.'));
        return;
      }

      const maxBytes = 80 * 1024;
      const maxDimension = 800;
      const qualityLevels = [0.65, 0.55, 0.45, 0.35, 0.25];
      const dimensions = [800, 720, 640, 560, 480, 400, 320];
      const dibujarYComprimir = (dimension, quality) => new Promise((resolveBlob, rejectBlob) => {
        const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (blob) resolveBlob(blob);
          else rejectBlob(new Error('El navegador no pudo comprimir la fotografía.'));
        }, 'image/jpeg', quality);
      });

      (async () => {
        let fotoComprimida = null;
        const dimensionesAUsar = dimensions.filter(dimension => dimension <= maxDimension);
        for (const dimension of dimensionesAUsar) {
          for (const calidad of qualityLevels) {
            const blob = await dibujarYComprimir(dimension, calidad);
            if (blob.size < maxBytes) {
              fotoComprimida = blob;
              break;
            }
          }
          if (fotoComprimida) break;
        }
        if (!fotoComprimida) {
          throw new Error('La fotografía no pudo reducirse a menos de 80 KB. Adjunta una imagen más pequeña.');
        }
        canvas.width = 0;
        canvas.height = 0;
        resolve(await leerArchivoComoDataURL(fotoComprimida));
      })().catch(error => {
        canvas.width = 0;
        canvas.height = 0;
        reject(error);
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo abrir la fotografía seleccionada.'));
    };
    image.src = objectUrl;
  });
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

  if (screenId === 'screen-seguimiento' && state.dniActual) {
    void cargarHistorialCiudadano();
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
    suscribirHistorialRealtime();
    mostrarPantalla('screen-home');
    document.getElementById('btn-ir-seguimiento')?.classList.remove('hidden');
    document.getElementById('btn-mis-reportes')?.classList.remove('hidden');
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

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    const ciudadanoDni = state.dniActual || user?.app_metadata?.dni;
    if (!ciudadanoDni || user?.app_metadata?.role !== 'ciudadano') {
      throw new Error('Tu sesión ciudadana venció. Inicia sesión nuevamente antes de enviar.');
    }
    if (!Number.isFinite(state.lat) || !Number.isFinite(state.lng)) {
      throw new Error('Confirma una ubicación válida antes de enviar el reporte.');
    }

    const tipo = CATALOGO_TIPOS[state.tipoSeleccionado] ? state.tipoSeleccionado : 'auxilio';
    const infoTipo = CATALOGO_TIPOS[tipo];
    const inputReferencia = document.getElementById('ref-texto');
    state.referenciaTexto = inputReferencia?.value.trim() || state.referenciaTexto.trim();
    const inputNotaEvidencia = document.getElementById('evidencia-texto');
    state.notaEvidencia = inputNotaEvidencia?.value.trim() || '';
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
      audio: null,
      audio_referencia: audioVozBase64,
      audio_evidencia: audioEvidenceBase64,
      nota_evidencia: state.notaEvidencia,
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

const COLUMNAS_HISTORIAL_CIUDADANO = 'ticket, tipo, prioridad, estado, referencia, nota_evidencia, unidad, unidad_codigo, eta_minutos, observaciones, timestamp, atendido_at';
const CAMPOS_HISTORIAL_CIUDADANO = COLUMNAS_HISTORIAL_CIUDADANO.split(',').map(columna => columna.trim());

async function consultarEstadoTicket(codigoTicket, notificarNoEncontrado = false) {
  if (!codigoTicket) return false;
  if (!supabaseClient) {
    if (notificarNoEncontrado) showToast('No se pudo conectar con Supabase para consultar el seguimiento.', 'error');
    return false;
  }
  if (state.consultaSeguimientoEnCurso) return false;
  state.consultaSeguimientoEnCurso = true;

  try {
    const { data: incidente, error } = await supabaseClient
      .from('incidentes')
      .select('ticket,estado,unidad,unidad_codigo,eta_minutos')
      .eq('ticket', codigoTicket.trim().toUpperCase())
      .single();
    if (error) {
      console.error('No se pudo consultar el seguimiento:', error);
      if (notificarNoEncontrado) {
        showToast(error.code === 'PGRST116'
          ? `El ticket ${codigoTicket} no fue encontrado`
          : 'No se pudo consultar el estado. Inténtalo nuevamente.', 'error');
      }
      return false;
    }

    renderizarEstadoTicket(incidente);
    return true;
  } catch (error) {
    console.error('No se pudo consultar el seguimiento:', error);
    if (notificarNoEncontrado) {
      showToast('No se pudo consultar el estado. Inténtalo nuevamente.', 'error');
    }
    return false;
  } finally {
    state.consultaSeguimientoEnCurso = false;
  }
}

function renderizarEstadoTicket(incidente) {
  const badgeEstado = document.getElementById('badge-estado');
  if (badgeEstado) {
    badgeEstado.className = `badge-status badge-${incidente.estado}`;
    badgeEstado.textContent = String(incidente.estado || '').replace('_', ' ').toUpperCase();
  }

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
  const ticketNormalizado = String(ticket || '').trim().toUpperCase();
  if (!ticketNormalizado) return;
  state.ticketSeguimientoActual = ticketNormalizado;
  if (state.dniActual) suscribirHistorialRealtime();
  void consultarEstadoTicket(ticketNormalizado, true);
}

function actualizarEstadoHistorialRealtime(texto, activo) {
  const indicador = document.getElementById('ciudadano-realtime-status');
  if (!indicador) return;
  indicador.textContent = texto;
  indicador.classList.toggle('text-success', activo);
  indicador.classList.toggle('text-warning', !activo);
}

function renderizarHistorialCiudadano() {
  const lista = document.getElementById('ciudadano-historial-lista');
  if (!lista) return;
  lista.replaceChildren();

  if (state.historialError && !state.historialIncidentes.length) {
    const error = document.createElement('p');
    error.className = 'text-danger small mb-0';
    error.textContent = state.historialError;
    lista.appendChild(error);
    return;
  }

  if (!state.historialIncidentes.length) {
    const vacio = document.createElement('p');
    vacio.className = 'text-muted small mb-0';
    vacio.textContent = 'Aún no tienes solicitudes registradas.';
    lista.appendChild(vacio);
    return;
  }

  const estados = {
    recibido: 'RECIBIDO',
    asignado: 'ASIGNADO',
    en_camino: 'EN CAMINO',
    atendido: 'ATENDIDO',
    cancelado: 'CANCELADO'
  };
  const iconos = {
    violencia: 'img/icon-violencia.png',
    robo: 'img/icon-robo.png',
    accidente: 'img/icon-accidente.png',
    auxilio: 'img/icon-auxilio.png',
    otros: 'img/icon-otros.png'
  };

  state.historialIncidentes.forEach(incidente => {
    const itemLista = document.createElement('div');
    itemLista.setAttribute('role', 'listitem');
    const tarjeta = document.createElement('button');
    tarjeta.type = 'button';
    tarjeta.className = 'ciudadano-historial-card';
    tarjeta.dataset.ticket = incidente.ticket;
    tarjeta.setAttribute('aria-label', `Abrir seguimiento del ticket ${incidente.ticket}, ${estados[incidente.estado] || incidente.estado}`);

    const cabecera = document.createElement('span');
    cabecera.className = 'ciudadano-historial-card-header';
    const ticket = document.createElement('strong');
    ticket.textContent = incidente.ticket || 'Ticket sin código';
    const estado = document.createElement('span');
    estado.className = `badge-status badge-${incidente.estado}`;
    estado.textContent = estados[incidente.estado] || String(incidente.estado || 'Estado desconocido').toUpperCase();
    cabecera.append(ticket, estado);

    const tipo = document.createElement('span');
    tipo.className = 'ciudadano-historial-tipo';
    const icono = document.createElement('img');
    icono.src = iconos[incidente.tipo] || iconos.otros;
    icono.alt = '';
    icono.setAttribute('aria-hidden', 'true');
    const tipoTexto = document.createElement('span');
    tipoTexto.textContent = CATALOGO_TIPOS[incidente.tipo]?.nombre || 'Otro incidente';
    tipo.append(icono, tipoTexto);

    const fecha = document.createElement('span');
    fecha.className = 'ciudadano-historial-meta';
    const fechaValida = incidente.timestamp ? new Date(incidente.timestamp) : null;
    fecha.textContent = fechaValida && !Number.isNaN(fechaValida.getTime())
      ? fechaValida.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
      : 'Fecha no disponible';

    const detalle = document.createElement('span');
    detalle.className = 'ciudadano-historial-meta';
    const unidad = incidente.unidad || incidente.unidad_codigo;
    detalle.textContent = unidad ? `Unidad: ${unidad}` : 'Unidad pendiente de asignación';

    tarjeta.append(cabecera, tipo, fecha, detalle);
    if (incidente.observaciones) {
      const observaciones = document.createElement('span');
      observaciones.className = 'ciudadano-historial-observaciones';
      observaciones.textContent = `Observaciones de cierre: ${incidente.observaciones}`;
      tarjeta.appendChild(observaciones);
    }
    itemLista.appendChild(tarjeta);
    lista.appendChild(itemLista);
  });
}

function aplicarIncidenteHistorialRealtime(payload, aplicarTrasCarga = false) {
  if (state.historialCargaEnCurso && !aplicarTrasCarga) {
    state.historialEventosPendientes.push(payload);
    return;
  }
  const registro = payload.new || {};
  const ticket = registro.ticket;
  if (!ticket) return;
  const incidenteLigero = {};
  CAMPOS_HISTORIAL_CIUDADANO.forEach(campo => {
    if (Object.prototype.hasOwnProperty.call(registro, campo)) {
      incidenteLigero[campo] = registro[campo];
    }
  });
  const indice = state.historialIncidentes.findIndex(item => item.ticket === ticket);
  if (indice >= 0) {
    Object.assign(state.historialIncidentes[indice], incidenteLigero);
  } else if (payload.eventType === 'INSERT') {
    state.historialIncidentes.push(incidenteLigero);
  } else {
    return;
  }
  state.historialIncidentes.sort((a, b) =>
    new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );
  renderizarHistorialCiudadano();
  if (ticket === state.ticketSeguimientoActual) renderizarEstadoTicket(incidenteLigero);
}

function suscribirHistorialRealtime() {
  const dni = state.dniActual;
  if (!supabaseClient || !dni) return;
  if (state.historialRealtimeChannel && state.historialDniSuscrito === dni) return;
  if (state.historialRealtimeChannel) {
    const canalAnterior = state.historialRealtimeChannel;
    state.historialRealtimeChannel = null;
    void supabaseClient.removeChannel(canalAnterior).then(estado => {
      if (estado !== 'ok') console.warn('No se pudo cerrar el canal Realtime del ciudadano:', estado);
    }).catch(error => console.error('Error al cerrar el canal Realtime del ciudadano:', error));
  }

  state.historialDniSuscrito = dni;
  state.historialRealtimeChannel = supabaseClient
    .channel(`ciudadano-incidentes-${dni}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'incidentes',
      filter: `ciudadano_dni=eq.${dni}`
    }, aplicarIncidenteHistorialRealtime)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'incidentes',
      filter: `ciudadano_dni=eq.${dni}`
    }, aplicarIncidenteHistorialRealtime)
    .subscribe(estado => {
      if (estado === 'SUBSCRIBED') {
        actualizarEstadoHistorialRealtime('Tiempo real activo', true);
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estado)) {
        actualizarEstadoHistorialRealtime('Realtime desconectado · Actualiza manualmente', false);
      }
    });
}

async function cargarHistorialCiudadano() {
  if (state.historialCargaEnCurso) return false;
  if (!supabaseClient || !state.dniActual) {
    showToast('Inicia sesión como ciudadano para consultar tus solicitudes.', 'error');
    return false;
  }
  state.historialCargaEnCurso = true;
  state.historialEventosPendientes = [];
  const lista = document.getElementById('ciudadano-historial-lista');
  if (lista && !state.historialIncidentes.length) {
    lista.textContent = 'Cargando tus solicitudes…';
  }

  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const usuario = sessionData.session?.user;
    if (usuario?.app_metadata?.role !== 'ciudadano' ||
        usuario.app_metadata.dni !== state.dniActual) {
      throw new Error('Tu sesión ciudadana venció. Inicia sesión nuevamente.');
    }

    suscribirHistorialRealtime();
    const { data, error } = await supabaseClient
      .from('incidentes')
      .select(COLUMNAS_HISTORIAL_CIUDADANO)
      .eq('ciudadano_dni', state.dniActual)
      .order('timestamp', { ascending: false });
    if (error) throw error;
    state.historialIncidentes = data || [];
    state.historialError = null;
  } catch (error) {
    console.error('No se pudo cargar el historial del ciudadano:', error);
    state.historialError = error.message || 'No se pudo cargar tu historial.';
    showToast(error.message || 'No se pudo cargar el historial de solicitudes.', 'error');
  } finally {
    const eventosPendientes = state.historialEventosPendientes.splice(0);
    eventosPendientes.forEach(payload => aplicarIncidenteHistorialRealtime(payload, true));
    state.historialCargaEnCurso = false;
    renderizarHistorialCiudadano();
  }
  return !state.historialError;
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
  const inputNotaEvidencia = document.getElementById('evidencia-texto');
  inputNotaEvidencia?.addEventListener('input', () => {
    state.notaEvidencia = inputNotaEvidencia.value;
  });
  const previewFoto = document.getElementById('preview-foto');
  const labelFoto = document.getElementById('foto-label-text');

  if (inputFoto) {
    inputFoto.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        state.fotoBlob = file;
        fotoBase64 = null;
        if (labelFoto) labelFoto.textContent = `Foto: ${file.name.substring(0, 18)}...`;
        fotoDataUrlPromise = optimizarFotoComoDataURL(file).then((dataUrl) => {
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
          showToast(error.message || 'No se pudo leer la fotografía seleccionada.', 'error');
          if (state.fotoBlob === file) {
            state.fotoBlob = null;
            fotoBase64 = null;
            inputFoto.value = '';
            if (previewFoto) {
              previewFoto.removeAttribute('src');
              previewFoto.classList.add('d-none');
            }
            if (labelFoto) labelFoto.textContent = 'Tomar o adjuntar foto';
          }
          return true;
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

  document.getElementById('btn-actualizar-estado')?.addEventListener('click', () => {
    const button = document.getElementById('btn-actualizar-estado');
    const ticket = document.getElementById('input-ticket')?.value.trim();
    if (!ticket) {
      showToast('Ingresa o selecciona un ticket para consultar su estado.', 'info');
      return;
    }
    if (button.disabled) return;
    state.ticketSeguimientoActual = ticket.toUpperCase();
    suscribirHistorialRealtime();
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Actualizando…</span>';
    void consultarEstadoTicket(ticket, true).then(actualizado => {
      if (actualizado) showToast('Estado actualizado.', 'success');
    }).finally(() => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
    });
  });

  document.getElementById('btn-refrescar-historial-ciudadano')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Actualizando…</span>';
    try {
      const actualizado = await cargarHistorialCiudadano();
      if (actualizado) showToast('Historial actualizado.', 'success');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
    }
  });

  document.getElementById('btn-mis-reportes')?.addEventListener('click', () => {
    mostrarPantalla('screen-seguimiento');
  });

  document.getElementById('ciudadano-historial-lista')?.addEventListener('click', event => {
    const tarjeta = event.target.closest('button[data-ticket]');
    if (!tarjeta) return;
    const ticket = tarjeta.dataset.ticket;
    const pantallaSeguimiento = document.getElementById('screen-seguimiento');
    if (!pantallaSeguimiento?.classList.contains('active')) {
      mostrarPantalla('screen-seguimiento');
    }
    const inputTicket = document.getElementById('input-ticket');
    if (inputTicket) inputTicket.value = ticket;
    activarMonitoreoSeguimiento(ticket);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const btnNuevoRep = document.getElementById('btn-nuevo-reporte');
  if (btnNuevoRep) {
    btnNuevoRep.addEventListener('click', () => {
      mostrarPantalla('screen-home');
      state.tipoSeleccionado = null;
      state.referenciaTexto = '';
      state.notaEvidencia = '';
      if (inputNotaEvidencia) inputNotaEvidencia.value = '';
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
        suscribirHistorialRealtime();
        mostrarPantalla('screen-home');
        document.getElementById('btn-ir-seguimiento')?.classList.remove('hidden');
        document.getElementById('btn-mis-reportes')?.classList.remove('hidden');
      }
    }).catch(error => console.error('No se pudo restaurar la sesión ciudadana:', error));
  }

  console.log('Módulo Ciudadano inicializado con persistencia Supabase.');
});