/**
 * public/js/sereno.js
 * Lógica Frontend del Rol Serenazgo en Campo — Sistema Inclusivo de Atención
 * Recepción Realtime de asignaciones desde Supabase
 * Flujo Táctico: Asignado -> En Camino -> Cierre con Observaciones (RF-07)
 */

'use strict';

const supabaseUrl = 'https://lipzgvzhiznoebmzjmwi.supabase.co';
const supabaseKey = 'sb_publishable_HdsFY1neo8q0nRCp-Wog1A_ideexOdx';
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'serenazgo-sereno-auth' }
  })
  : null;

// ─── Estado Local del Agente de Serenazgo ────────────────────────────────────
const serenoState = {
  agenteCodigo: 'SR-01', // Código de unidad de patrulla asignada
  agenteNombre: 'Patrulla SR-01 (Centro - Terán)',
  userId: null,
  incidenteActivoTicket: null,
  incidenteActual: null,
  consultaAsignacionEnCurso: false,
  mapaSereno: null,
  markerAgente: null,
  markerIncidente: null,
  realtimeChannel: null,
  evidenciasPorTicket: new Map(),
  refreshInFlight: false,
  posicionAgente: { lat: -12.1620, lng: -77.0225 }, // Posición base en Chorrillos
  lastLoadError: null,
};

const COLUMNAS_LIGERAS_INCIDENTES_SERENO = 'id, ticket, ciudadano_dni, tipo, prioridad, ubicacion, referencia, nota_evidencia, tiene_audio, tiene_audio_evidencia, tiene_foto, estado, unidad_asignada, unidad, unidad_codigo, eta_minutos, observaciones, timestamp, updated_at, atendido_at';
const POSICIONES_UNIDADES = {
  'SR-01': { lat: -12.1620, lng: -77.0225 },
  'SR-02': { lat: -12.1580, lng: -77.0260 },
  'SR-03': { lat: -12.1750, lng: -77.0140 },
  'SR-04': { lat: -12.1810, lng: -77.0190 }
};

// Configuración de iconos por tipo de emergencia
const ICONOS_EMERGENCIA = {
  violencia: '👊',
  robo:      '🦹',
  accidente: '🚗',
  auxilio:   '🆘'
};

// ─── Notificaciones Toast y Vibración ────────────────────────────────────────

function mostrarToast(msg, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  const icon = document.createElement('span');
  icon.textContent = tipo === 'success' ? '✅' : tipo === 'error' ? '❌' : 'ℹ️';
  const text = document.createElement('span');
  text.textContent = msg;
  t.append(icon, text);
  container.appendChild(t);

  setTimeout(() => t.remove(), 3500);
}

function vibrarAlerta(patron = [120, 60, 120]) {
  if ('vibrate' in navigator) {
    navigator.vibrate(patron);
  }
}

// ─── Monitoreo Realtime de asignaciones ──────────────────────────────────────

async function verificarAsignacionesAgente() {
  if (!supabaseClient) {
    mostrarToast('Configura Supabase antes de consultar los despachos.', 'error');
    return;
  }
  if (serenoState.consultaAsignacionEnCurso) return;
  serenoState.consultaAsignacionEnCurso = true;

  try {
    const { data: miCaso, error } = await supabaseClient
      .from('incidentes')
      .select(COLUMNAS_LIGERAS_INCIDENTES_SERENO)
      .eq('unidad_asignada', serenoState.agenteCodigo)
      .in('estado', ['asignado', 'en_camino'])
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('No se pudo consultar la asignación del agente:', error);
      if (serenoState.lastLoadError !== error.message) {
        mostrarToast(error.message || 'No se pudo consultar la asignación.', 'error');
        serenoState.lastLoadError = error.message;
      }
      return;
    }
    serenoState.lastLoadError = null;

    if (!miCaso) {
      serenoState.incidenteActual = null;
      renderizarSinAsignacion();
      renderizarSectorList([]);
      return;
    }

    aplicarAsignacionAgente(miCaso);
  } catch (error) {
    console.error('No se pudo consultar la asignación del agente:', error);
    if (serenoState.lastLoadError !== error.message) {
      mostrarToast(error.message || 'No se pudo consultar la asignación.', 'error');
      serenoState.lastLoadError = error.message;
    }
  } finally {
    serenoState.consultaAsignacionEnCurso = false;
  }
}

async function cargarEvidenciasAsignacion(ticket) {
  let evidenciaPromise = serenoState.evidenciasPorTicket.get(ticket);
  if (!evidenciaPromise) {
    evidenciaPromise = supabaseClient
      .from('incidentes')
      .select('foto,audio,audio_referencia,audio_evidencia,nota_evidencia')
      .eq('ticket', ticket)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        return data || {};
      });
    serenoState.evidenciasPorTicket.set(ticket, evidenciaPromise);
  }

  try {
    const data = await evidenciaPromise;
    if (serenoState.incidenteActivoTicket !== ticket || !serenoState.incidenteActual) return;

    Object.assign(serenoState.incidenteActual, data);
    renderizarEvidenciasAsignacion(serenoState.incidenteActual);
  } catch (error) {
    serenoState.evidenciasPorTicket.delete(ticket);
    console.error('No se pudieron cargar las evidencias del incidente:', error);
    mostrarToast(error.message || 'No se pudieron cargar las evidencias del incidente.', 'error');
  }
}

function aplicarAsignacionAgente(caso) {
  const esNuevaAsignacion = serenoState.incidenteActivoTicket !== caso.ticket;
  serenoState.incidenteActual = {
    ...(esNuevaAsignacion ? {} : serenoState.incidenteActual),
    ...caso
  };
  renderizarEmergenciaAsignada(serenoState.incidenteActual);
  renderizarSectorList([serenoState.incidenteActual]);

  if (esNuevaAsignacion) {
    renderizarEvidenciasAsignacion(serenoState.incidenteActual);
    if (caso.tiene_foto || caso.tiene_audio || caso.tiene_audio_evidencia) {
      void cargarEvidenciasAsignacion(caso.ticket);
    }
  }
}

function aplicarCambioIncidenteRealtime(payload) {
  const caso = payload.new || {};
  const ticket = caso.ticket || payload.old?.ticket;
  const esMiUnidad = caso.unidad_asignada === serenoState.agenteCodigo;
  const esEstadoActivo = ['asignado', 'en_camino'].includes(caso.estado);

  if (esMiUnidad && esEstadoActivo) {
    aplicarAsignacionAgente(caso);
    return;
  }
  if (ticket && serenoState.incidenteActivoTicket === ticket) {
    serenoState.incidenteActual = null;
    renderizarSinAsignacion();
    renderizarSectorList([]);
  }
}

function actualizarEstadoRealtime(texto, activo) {
  const indicador = document.getElementById('sereno-realtime-status');
  if (!indicador) return;
  indicador.textContent = texto;
  indicador.classList.toggle('text-success', activo);
  indicador.classList.toggle('text-warning', !activo);
}

function suscribirAsignacionesRealtime() {
  if (!supabaseClient || !serenoState.userId) return;
  if (serenoState.realtimeChannel) {
    const canalAnterior = serenoState.realtimeChannel;
    serenoState.realtimeChannel = null;
    void supabaseClient.removeChannel(canalAnterior).then(estado => {
      if (estado !== 'ok') console.warn('No se pudo cerrar el canal Realtime anterior:', estado);
    }).catch(error => console.error('Error al cerrar el canal Realtime anterior:', error));
  }

  serenoState.realtimeChannel = supabaseClient
    .channel(`sereno-incidentes-${serenoState.agenteCodigo}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'incidentes',
      filter: `unidad_asignada=eq.${serenoState.agenteCodigo}`
    }, aplicarCambioIncidenteRealtime)
    .subscribe(estado => {
      if (estado === 'SUBSCRIBED') {
        actualizarEstadoRealtime('Tiempo real activo', true);
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estado)) {
        actualizarEstadoRealtime('Realtime desconectado', false);
      }
    });
}

function renderizarEmergenciaAsignada(caso) {
  const esNuevaAlerta = (serenoState.incidenteActivoTicket !== caso.ticket);
  serenoState.incidenteActivoTicket = caso.ticket;

  const banner = document.getElementById('asignacion-banner');
  const ticketBadge = document.getElementById('asignacion-ticket');
  const iconoEl = document.getElementById('asignacion-icono');
  const titleEl = document.getElementById('asignacion-title');
  const descEl = document.getElementById('asignacion-desc');
  const extraBox = document.getElementById('asignacion-extra');
  const etaVal = document.getElementById('asignacion-eta-val');
  const estadoTexto = document.getElementById('sereno-estado-texto');
  const estadoDot = document.getElementById('estado-dot');

  const btnEnCamino = document.getElementById('btn-en-camino');
  const btnAtendido = document.getElementById('btn-atendido');

  // Actualizar tarjeta superior
  if (banner) banner.classList.remove('sin-asignacion');
  if (ticketBadge) {
    ticketBadge.classList.remove('hidden');
    ticketBadge.textContent = caso.ticket;
  }
  if (iconoEl) iconoEl.textContent = ICONOS_EMERGENCIA[caso.tipo] || '🚨';
  if (titleEl) titleEl.textContent = `EMERGENCIA: ${caso.tipo.toUpperCase()}`;
  if (descEl) {
    descEl.textContent = caso.referencia ? `"${caso.referencia}"` : `📍 Lat: ${caso.ubicacion?.lat.toFixed(4)}, Lng: ${caso.ubicacion?.lng.toFixed(4)}`;
  }
  if (extraBox) extraBox.classList.remove('hidden');
  if (etaVal) etaVal.textContent = caso.eta_minutos || '3';

  if (estadoTexto) estadoTexto.textContent = 'En Intervención';
  if (estadoDot) estadoDot.className = 'status-dot-field ocupado';

  // Habilitar botones de acción según el estado
  if (caso.estado === 'asignado') {
    if (btnEnCamino) btnEnCamino.disabled = false;
    if (btnAtendido) btnAtendido.disabled = true;
  } else if (caso.estado === 'en_camino') {
    if (btnEnCamino) btnEnCamino.disabled = true;
    if (btnAtendido) btnAtendido.disabled = false;
  }

  // Tono acústico y vibración al recibir nueva alerta
  if (esNuevaAlerta) {
    vibrarAlerta([200, 100, 200, 100, 300]);
    mostrarToast(`🚨 NUEVA ASIGNACIÓN: ${caso.ticket} - ${caso.tipo.toUpperCase()}`, 'error');
  }

  // Actualizar mapa táctico
  const latInc = caso.ubicacion?.lat || -12.1611;
  const lngInc = caso.ubicacion?.lng || -77.0210;
  actualizarMapaSerenazgo(latInc, lngInc, caso.ticket);
}

function renderizarEvidenciasAsignacion(caso) {
  const container = document.getElementById('asignacion-evidencias');
  const referencia = document.getElementById('asignacion-referencia');
  const notaEvidencia = document.getElementById('asignacion-nota-evidencia');
  const fotoContainer = document.getElementById('asignacion-foto-container');
  const foto = document.getElementById('asignacion-foto');
  const audioReferenciaContainer = document.getElementById('asignacion-audio-referencia-container');
  const audioReferencia = document.getElementById('asignacion-audio-referencia');
  const audioEvidenciaContainer = document.getElementById('asignacion-audio-evidencia-container');
  const audioEvidencia = document.getElementById('asignacion-audio-evidencia');

  if (!container || !referencia || !notaEvidencia || !fotoContainer || !foto ||
      !audioReferenciaContainer || !audioReferencia || !audioEvidenciaContainer || !audioEvidencia) return;

  const nota = String(caso.referencia || caso.referencia_texto || '').trim();
  referencia.textContent = nota ? `Anotación: ${nota}` : '';
  referencia.classList.toggle('hidden', !nota);
  const notaIncidente = String(caso.nota_evidencia || '').trim();
  notaEvidencia.textContent = notaIncidente ? `Evidencia escrita: ${notaIncidente}` : '';
  notaEvidencia.classList.toggle('hidden', !notaIncidente);

  const fotoSrc = caso.foto || caso.evidencia_foto;
  foto.removeAttribute('src');
  fotoContainer.classList.toggle('hidden', !fotoSrc);
  if (fotoSrc) foto.src = fotoSrc;

  const audioReferenciaSrc = caso.audio_referencia || caso.referencia_voz;
  const audioEvidenciaSrc = caso.audio_evidencia || (!audioReferenciaSrc ? caso.audio : null);
  [[audioReferencia, audioReferenciaContainer, audioReferenciaSrc],
    [audioEvidencia, audioEvidenciaContainer, audioEvidenciaSrc]].forEach(([player, playerContainer, src]) => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    playerContainer.classList.toggle('hidden', !src);
    if (src) player.src = src;
  });

  container.classList.toggle('hidden', !(nota || notaIncidente || fotoSrc || audioReferenciaSrc || audioEvidenciaSrc));
}

function limpiarEvidenciasAsignacion() {
  const container = document.getElementById('asignacion-evidencias');
  if (!container || container.classList.contains('hidden')) return;

  ['asignacion-audio-referencia', 'asignacion-audio-evidencia'].forEach(id => {
    const player = document.getElementById(id);
    if (!player) return;
    player.pause();
    player.removeAttribute('src');
    player.load();
  });
  const foto = document.getElementById('asignacion-foto');
  if (foto) foto.removeAttribute('src');
  container.classList.add('hidden');
}

function renderizarSinAsignacion() {
  serenoState.incidenteActivoTicket = null;

  const banner = document.getElementById('asignacion-banner');
  const ticketBadge = document.getElementById('asignacion-ticket');
  const iconoEl = document.getElementById('asignacion-icono');
  const titleEl = document.getElementById('asignacion-title');
  const descEl = document.getElementById('asignacion-desc');
  const extraBox = document.getElementById('asignacion-extra');
  const estadoTexto = document.getElementById('sereno-estado-texto');
  const estadoDot = document.getElementById('estado-dot');

  const btnEnCamino = document.getElementById('btn-en-camino');
  const btnAtendido = document.getElementById('btn-atendido');

  if (banner) banner.classList.add('sin-asignacion');
  if (ticketBadge) ticketBadge.classList.add('hidden');
  if (iconoEl) iconoEl.textContent = '🟢';
  if (titleEl) titleEl.textContent = 'Sin Asignación Activa';
  if (descEl) descEl.textContent = 'En patrullaje preventivo. Esperando despacho de la central.';
  if (extraBox) extraBox.classList.add('hidden');
  limpiarEvidenciasAsignacion();

  if (estadoTexto) estadoTexto.textContent = 'Disponible';
  if (estadoDot) estadoDot.className = 'status-dot-field';

  if (btnEnCamino) btnEnCamino.disabled = true;
  if (btnAtendido) btnAtendido.disabled = true;

  // Centrar mapa en la posición del patrullero
  actualizarMapaSerenazgo(null, null, null);
}

// ─── Mapa Leaflet Táctico de Serenazgo ────────────────────────────────────────

function actualizarMapaSerenazgo(latIncidente, lngIncidente, ticket) {
  const container = document.getElementById('mapa-sereno');
  if (!container) return;

  if (!serenoState.mapaSereno) {
    serenoState.mapaSereno = L.map('mapa-sereno', { zoomControl: false }).setView(
      [serenoState.posicionAgente.lat, serenoState.posicionAgente.lng],
      15
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(serenoState.mapaSereno);
  }

  const popupPatrulla = `<strong>Mi Patrulla (${serenoState.agenteCodigo})</strong>`;

  // Marcador de la patrulla
  if (!serenoState.markerAgente) {
    const agenteIcon = L.divIcon({
      html: `<div style="background:#061A2E;color:#fff;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;border:3px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.4);">🚔</div>`,
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
    serenoState.markerAgente = L.marker([serenoState.posicionAgente.lat, serenoState.posicionAgente.lng], { icon: agenteIcon })
      .addTo(serenoState.mapaSereno)
      .bindPopup(popupPatrulla);
  } else {
    serenoState.markerAgente
      .setLatLng([serenoState.posicionAgente.lat, serenoState.posicionAgente.lng])
      .setPopupContent(popupPatrulla);
  }

  // Marcador del incidente
  if (latIncidente && lngIncidente) {
    if (serenoState.markerIncidente) {
      serenoState.markerIncidente.setLatLng([latIncidente, lngIncidente]);
    } else {
      const incIcon = L.divIcon({
        html: `<div style="background:#DC2626;color:#fff;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;border:3px solid #fff;box-shadow:0 4px 12px rgba(220,38,38,0.5);animation:pulseLive 1.5s infinite;">🚨</div>`,
        className: '',
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });
      serenoState.markerIncidente = L.marker([latIncidente, lngIncidente], { icon: incIcon })
        .addTo(serenoState.mapaSereno)
        .bindPopup(`<strong>Emergencia ${ticket}</strong>`);
    }

    // Ajustar límites de vista para abarcar patrulla e incidente
    const bounds = L.latLngBounds(
      [serenoState.posicionAgente.lat, serenoState.posicionAgente.lng],
      [latIncidente, lngIncidente]
    );
    serenoState.mapaSereno.fitBounds(bounds, { padding: [40, 40] });
  } else {
    // Si no hay incidente, remover marcador de emergencia
    if (serenoState.markerIncidente) {
      serenoState.markerIncidente.remove();
      serenoState.markerIncidente = null;
    }
    serenoState.mapaSereno.setView([serenoState.posicionAgente.lat, serenoState.posicionAgente.lng], 15);
  }

  setTimeout(() => serenoState.mapaSereno.invalidateSize(), 200);
}

// ─── Acciones de Despacho (En Camino / Atendido) ──────────────────────────────

async function marcarEnCamino() {
  if (!serenoState.incidenteActivoTicket) return;
  const btn = document.getElementById('btn-en-camino');
  if (btn?.disabled) return;
  const textoOriginal = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Actualizando…';
  }

  let guardado = false;
  try {
    const { error } = await supabaseClient
      .from('incidentes')
      .update({ estado: 'en_camino', updated_at: new Date().toISOString() })
      .eq('ticket', serenoState.incidenteActivoTicket)
      .eq('unidad_asignada', serenoState.agenteCodigo)
      .eq('estado', 'asignado')
      .select('ticket')
      .single();
    if (error) throw error;
    guardado = true;
    if (serenoState.incidenteActual) serenoState.incidenteActual.estado = 'en_camino';
    renderizarEmergenciaAsignada(serenoState.incidenteActual);
    mostrarToast('🚔 Marcado como "En Camino". Notificado a la Central y al Ciudadano', 'info');
    vibrarAlerta([80]);
  } catch (error) {
    console.error('No se pudo actualizar el estado del incidente:', error);
    mostrarToast(error.message || 'No se pudo cambiar el estado a En Camino.', 'error');
  } finally {
    if (btn) {
      if (textoOriginal) btn.innerHTML = textoOriginal;
      if (!guardado) btn.disabled = false;
    }
  }
}

function abrirModalCierreSereno() {
  const modal = document.getElementById('modal-cierre-sereno');
  const obsEl = document.getElementById('cierre-sereno-obs');
  if (obsEl) obsEl.value = '';
  if (modal) modal.classList.remove('hidden');
}

async function confirmarCierreSereno() {
  if (!serenoState.incidenteActivoTicket) return;

  const estadoSelect = document.getElementById('cierre-sereno-estado');
  const obsText = document.getElementById('cierre-sereno-obs');
  const estado = estadoSelect ? estadoSelect.value : 'atendido';
  const actualizadoAt = new Date().toISOString();
  const btn = document.getElementById('btn-confirmar-cierre-sereno');
  if (btn?.disabled) return;
  const textoOriginal = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Guardando…';
  }

  try {
    const { error } = await supabaseClient
      .from('incidentes')
      .update({
        estado,
        observaciones: obsText && obsText.value.trim()
          ? obsText.value.trim()
          : `Emergencia atendida y resuelta por la unidad ${serenoState.agenteCodigo}.`,
        atendido_at: actualizadoAt,
        updated_at: actualizadoAt
      })
      .eq('ticket', serenoState.incidenteActivoTicket)
      .eq('unidad_asignada', serenoState.agenteCodigo)
      .select('ticket')
      .single();
    if (error) throw error;
    mostrarToast(`✅ Emergencia ${serenoState.incidenteActivoTicket} cerrada satisfactoriamente`, 'success');
    vibrarAlerta([100, 50, 150]);
  } catch (error) {
    console.error('No se pudo cerrar el incidente:', error);
    mostrarToast(error.message || 'No se pudo guardar el cierre del incidente.', 'error');
    return;
  } finally {
    if (btn) {
      btn.disabled = false;
      if (textoOriginal) btn.innerHTML = textoOriginal;
    }
  }

  const modal = document.getElementById('modal-cierre-sereno');
  if (modal) modal.classList.add('hidden');
  serenoState.incidenteActual = null;
  renderizarSinAsignacion();
}

// ─── Lista de Emergencias del Sector ─────────────────────────────────────────

function renderizarSectorList(cases) {
  const container = document.getElementById('sereno-incidents-list');
  if (!container) return;

  const activos = cases.filter(c => c.estado !== 'atendido' && c.estado !== 'cancelado');
  if (activos.length === 0) {
    container.innerHTML = '<div class="text-center py-4 text-muted small">Sin despachos activos para tu unidad.</div>';
    return;
  }

  container.innerHTML = activos.map(c => {
    const esMio = (c.ticket === serenoState.incidenteActivoTicket);
    const esAlta = (c.tipo === 'violencia' || c.tipo === 'auxilio');
    const tipo = escaparHTML(c.tipo);
    return `
      <div class="sereno-inc-card ${esAlta ? 'alta' : ''}">
        <div class="sereno-inc-icon">${ICONOS_EMERGENCIA[c.tipo] || '🚨'}</div>
        <div class="sereno-inc-info">
          <div class="inc-tipo">${tipo.toUpperCase()} ${esMio ? '<span class="badge bg-primary ms-1">MI ASIGNACIÓN</span>' : ''}</div>
          <div class="inc-ticket">${escaparHTML(c.ticket)}</div>
          <div class="inc-ref">${escaparHTML(c.referencia || 'Sin referencia')}</div>
        </div>
        <span class="badge-status badge-${escaparHTML(c.estado)}">${escaparHTML(c.estado)}</span>
      </div>`;
  }).join('');
}

function escaparHTML(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[caracter]);
}

// ─── Control de Pantallas Móviles de Serenazgo ───────────────────────────────

function cambiarPantallaSereno(screenId) {
  document.querySelectorAll('.sereno-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sereno-nav-btn').forEach(b => b.classList.remove('active'));

  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  const navBtn = document.querySelector(`.sereno-nav-btn[data-screen="${screenId}"]`);
  if (navBtn) navBtn.classList.add('active');

  if (screenId === 'screen-asignacion' && serenoState.mapaSereno) {
    setTimeout(() => serenoState.mapaSereno.invalidateSize(), 200);
  }
}

async function activarSesionSereno(user) {
  const metadata = user?.app_metadata || {};
  const unidadesValidas = Object.keys(POSICIONES_UNIDADES);
  if (metadata.role !== 'sereno' || !unidadesValidas.includes(metadata.unit_code)) {
    throw new Error('Esta cuenta no tiene permisos de unidad de campo válida.');
  }

  serenoState.agenteCodigo = metadata.unit_code;
  serenoState.agenteNombre = metadata.nombre || `Patrulla ${metadata.unit_code}`;
  serenoState.userId = user.id;
  serenoState.posicionAgente = { ...POSICIONES_UNIDADES[metadata.unit_code] };

  const nombreEl = document.getElementById('sereno-agente-nombre');
  const perfilNombre = document.getElementById('perfil-nombre');
  if (nombreEl) nombreEl.textContent = serenoState.agenteNombre;
  if (perfilNombre) perfilNombre.textContent = `${serenoState.agenteNombre} (${serenoState.agenteCodigo})`;

  document.getElementById('screen-login-sereno')?.classList.remove('active');
  document.getElementById('screen-login-sereno')?.classList.add('hidden');
  document.getElementById('sereno-header')?.classList.remove('hidden');
  document.getElementById('sereno-bottom-nav')?.classList.remove('hidden');
  cambiarPantallaSereno('screen-asignacion');
  actualizarMapaSerenazgo(null, null, null);
  suscribirAsignacionesRealtime();
  await verificarAsignacionesAgente();
}

// ─── Inicialización y Login de Serenazgo ────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // 1. Inicio de sesión de Agente con Supabase Auth
  const formLogin = document.getElementById('form-login-sereno');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('sereno-usuario')?.value.trim() || '';
      const password = document.getElementById('sereno-password')?.value || '';
      const errorEl = document.getElementById('sereno-login-error');
      const button = formLogin.querySelector('button[type="submit"]');
      if (errorEl) errorEl.classList.add('hidden');
      if (button) button.disabled = true;

      try {
        if (!supabaseClient) {
          throw new Error('No se pudo cargar la librería cliente de Supabase.');
        }
        const email = username.includes('@') ? username : `${username}@personal.serenazgo.invalid`;
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.user) {
          await supabaseClient.auth.signOut({ scope: 'local' });
          throw new Error('Supabase no devolvió la sesión de la unidad.');
        }
        if (data.user.app_metadata?.role !== 'sereno' ||
            !Object.prototype.hasOwnProperty.call(POSICIONES_UNIDADES, data.user.app_metadata?.unit_code)) {
          await supabaseClient.auth.signOut({ scope: 'local' });
          throw new Error('Esta cuenta no tiene permisos de unidad de campo válida.');
        }

        await activarSesionSereno(data.user);
      } catch (error) {
        console.error('No se pudo iniciar sesión como agente:', error);
        if (errorEl) {
          errorEl.textContent = error.message || 'No se pudo iniciar sesión.';
          errorEl.classList.remove('hidden');
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  // 2. Botón "En Camino"
  document.getElementById('btn-en-camino')?.addEventListener('click', marcarEnCamino);
  document.getElementById('btn-refresh-sereno')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled || serenoState.refreshInFlight) return;
    serenoState.refreshInFlight = true;
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Actualizando…</span>';
    try {
      await verificarAsignacionesAgente();
    } finally {
      serenoState.refreshInFlight = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
    }
  });

  // 3. Botón "Atendido" (Abre modal de cierre con observaciones)
  document.getElementById('btn-atendido')?.addEventListener('click', abrirModalCierreSereno);

  // 4. Modal de Cierre de Incidente
  document.getElementById('btn-confirmar-cierre-sereno')?.addEventListener('click', confirmarCierreSereno);
  document.getElementById('btn-cancelar-cierre-sereno')?.addEventListener('click', () => {
    document.getElementById('modal-cierre-sereno')?.classList.add('hidden');
  });

  // 5. Navegación inferior (Bottom Nav)
  document.querySelectorAll('.sereno-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetScreen = btn.getAttribute('data-screen');
      if (targetScreen) cambiarPantallaSereno(targetScreen);
    });
  });

  // 6. Logout
  document.getElementById('btn-logout-sereno')?.addEventListener('click', async () => {
    if (serenoState.realtimeChannel && supabaseClient) {
      const canal = serenoState.realtimeChannel;
      serenoState.realtimeChannel = null;
      void supabaseClient.removeChannel(canal).then(estado => {
        if (estado !== 'ok') console.warn('No se pudo cerrar el canal Realtime del sereno:', estado);
      }).catch(error => console.error('Error al cerrar el canal Realtime del sereno:', error));
    }
    serenoState.incidenteActual = null;
    serenoState.incidenteActivoTicket = null;
    serenoState.userId = null;
    serenoState.evidenciasPorTicket.clear();
    renderizarSinAsignacion();
    renderizarSectorList([]);
    document.getElementById('modal-cierre-sereno')?.classList.add('hidden');
    document.querySelectorAll('.sereno-screen').forEach(screen => screen.classList.remove('active'));
    const login = document.getElementById('screen-login-sereno');
    login?.classList.remove('hidden');
    login?.classList.add('active');
    document.getElementById('sereno-header')?.classList.add('hidden');
    document.getElementById('sereno-bottom-nav')?.classList.add('hidden');
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
      if (error) console.error('No se pudo cerrar la sesión de agente:', error);
    }
  });

  if (!supabaseClient) {
    console.error('No se pudo cargar la librería cliente de Supabase.');
  } else {
    supabaseClient.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      const user = data.session?.user;
      if (user?.app_metadata?.role === 'sereno') {
        await activarSesionSereno(user);
      }
    }).catch(error => {
      console.error('No se pudo restaurar la sesión del sereno:', error);
    });
  }
  console.log('Módulo Serenazgo en Campo inicializado con persistencia Supabase.');
});
