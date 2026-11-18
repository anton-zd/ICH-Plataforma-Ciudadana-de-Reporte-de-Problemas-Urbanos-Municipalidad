/**
 * public/js/dashboard.js
 * Lógica Frontend del Rol Operador Central — Sistema Inclusivo de Serenazgo
 * Gestión de Incidentes en Supabase con actualización Realtime
 * Regla de Negocio RN-01: Priorización automática de Violencia y Auxilio en la cola
 */

'use strict';

const supabaseUrl = 'https://lipzgvzhiznoebmzjmwi.supabase.co';
const supabaseKey = 'sb_publishable_HdsFY1neo8q0nRCp-Wog1A_ideexOdx';
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'serenazgo-operador-auth' }
  })
  : null;

const COLUMNAS_LIGERAS_INCIDENTES = 'id, ticket, ciudadano_dni, tipo, prioridad, ubicacion, referencia, nota_evidencia, tiene_audio, tiene_audio_evidencia, tiene_foto, estado, unidad_asignada, unidad, unidad_codigo, eta_minutos, observaciones, timestamp, updated_at, atendido_at';
const CAMPOS_LIGEROS_INCIDENTES = COLUMNAS_LIGERAS_INCIDENTES.split(',').map(columna => columna.trim());

// ─── Estado Local del Operador ───────────────────────────────────────────────
const dashboardState = {
  usuarioActual: null,
  filtroActual: 'todos',
  incidenteSeleccionado: null,
  unidadSeleccionadaId: null,
  mapaDashboard: null,
  markersList: [],
  realtimeChannel: null,
  chartInstances: {},
  casos: [],
  lastLoadError: null,
  refreshInFlight: false,
  pendingStatsRefresh: false,
  evidenciasPorTicket: new Map(),
  casesSignature: null,
};

// Flota de Unidades de Serenazgo de Chorrillos disponibles para despacho
const UNIDADES_DISPONIBLES = [
  { id: 'SR-01', codigo: 'SR-01', nombre: 'Patrulla Terán - Centro', tipo: 'Camioneta', sector: 'Chorrillos Casco', lat: -12.1620, lng: -77.0225 },
  { id: 'SR-02', codigo: 'SR-02', nombre: 'Motorizado Huaylas Express', tipo: 'Motocicleta', sector: 'Av. Huaylas', lat: -12.1580, lng: -77.0260 },
  { id: 'SR-03', codigo: 'SR-03', nombre: 'Patrulla Villa y Pantanos', tipo: 'Camioneta', sector: 'Los Pantanos', lat: -12.1750, lng: -77.0140 },
  { id: 'SR-04', codigo: 'SR-04', nombre: 'Motorizado Cedros del Villa', tipo: 'Motocicleta', sector: 'Los Cedros', lat: -12.1810, lng: -77.0190 }
];

// Metadatos visuales de categorías de incidentes
const TIPO_CONFIG = {
  violencia: { icon: '👊', badgeClass: 'badge-alta', bgClass: 'tipo-bg-violencia', label: 'Violencia' },
  robo:      { icon: '🦹', badgeClass: 'badge-normal', bgClass: 'tipo-bg-robo', label: 'Robo' },
  accidente: { icon: '🚗', badgeClass: 'badge-normal', bgClass: 'tipo-bg-accidente', label: 'Accidente' },
  auxilio:   { icon: '🆘', badgeClass: 'badge-alta', bgClass: 'tipo-bg-auxilio', label: 'Auxilio' },
  otros:     { icon: '📋', badgeClass: 'badge-normal', bgClass: 'bg-light', label: 'Otros' }
};

// ─── Carga de Incidentes desde Supabase ──────────────────────────────────────

function obtenerCasos() {
  return dashboardState.casos;
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

function actualizarFirmaCasos() {
  dashboardState.casesSignature = JSON.stringify(dashboardState.casos.map(caso => [
    caso.ticket, caso.estado, caso.unidad_asignada, caso.unidad_codigo,
    caso.timestamp, caso.updated_at, caso.atendido_at
  ]));
}

function extraerIncidenteLigero(registro) {
  const incidente = {};
  CAMPOS_LIGEROS_INCIDENTES.forEach(campo => {
    if (Object.prototype.hasOwnProperty.call(registro, campo)) {
      incidente[campo] = registro[campo];
    }
  });
  return incidente;
}

function renderizarVistasActivas() {
  renderizarDashboard();
  if (document.getElementById('view-historial')?.classList.contains('active')) {
    renderizarHistorial();
  }
  if (document.getElementById('view-estadisticas')?.classList.contains('active')) {
    renderizarEstadisticas();
  }
  if (document.getElementById('view-rendimiento')?.classList.contains('active')) {
    renderizarRendimiento();
  }
}

function aplicarCambioIncidenteRealtime(payload) {
  const registro = payload.new || {};
  const ticket = registro.ticket || payload.old?.ticket;
  const id = registro.id || payload.old?.id;
  const existente = dashboardState.casos.findIndex(caso =>
    (ticket && caso.ticket === ticket) || (id && caso.id === id)
  );

  if (payload.eventType === 'DELETE') {
    if (existente >= 0) dashboardState.casos.splice(existente, 1);
  } else if (ticket) {
    const incidenteLigero = extraerIncidenteLigero(registro);
    if (existente >= 0) {
      Object.assign(dashboardState.casos[existente], incidenteLigero);
    } else {
      dashboardState.casos.push(incidenteLigero);
    }
  } else {
    return;
  }

  dashboardState.casos.sort((a, b) =>
    new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );
  actualizarFirmaCasos();
  renderizarVistasActivas();
}

function actualizarIndicadorRealtime(texto, activo) {
  const indicador = document.getElementById('realtime-status');
  if (!indicador) return;
  indicador.textContent = texto;
  indicador.classList.toggle('text-success', activo);
  indicador.classList.toggle('text-warning', !activo);
}

function suscribirNuevosIncidentes() {
  if (!supabaseClient || !dashboardState.usuarioActual) return;
  if (dashboardState.realtimeChannel) {
    const canalAnterior = dashboardState.realtimeChannel;
    dashboardState.realtimeChannel = null;
    void supabaseClient.removeChannel(canalAnterior).then(estado => {
      if (estado !== 'ok') console.warn('No se pudo cerrar el canal Realtime anterior:', estado);
    }).catch(error => console.error('Error al cerrar el canal Realtime anterior:', error));
  }

  dashboardState.realtimeChannel = supabaseClient
    .channel('operador-incidentes-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'incidentes'
    }, aplicarCambioIncidenteRealtime)
    .subscribe(estado => {
      if (estado === 'SUBSCRIBED') {
        actualizarIndicadorRealtime('Tiempo real activo', true);
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estado)) {
        actualizarIndicadorRealtime('Realtime desconectado · Actualiza manualmente', false);
      }
    });
}

async function cargarIncidentes() {
  try {
    if (!supabaseClient) {
      throw new Error('No se pudo cargar la librería cliente de Supabase.');
    }
    const { data, error } = await supabaseClient
      .from('incidentes')
      .select(COLUMNAS_LIGERAS_INCIDENTES)
      .order('timestamp', { ascending: false });
    if (error) throw error;
    const signature = JSON.stringify((data || []).map(caso => [
      caso.ticket, caso.estado, caso.unidad_asignada, caso.unidad_codigo,
      caso.timestamp, caso.updated_at, caso.atendido_at
    ]));
    const dataChanged = signature !== dashboardState.casesSignature;
    dashboardState.casesSignature = signature;
    dashboardState.casos = data || [];
    renderizarDashboard();
    return dataChanged;
  } catch (error) {
    console.error('No se pudieron cargar los incidentes desde Supabase:', error);
    throw error;
  }
}

async function actualizarDatosDashboard({ actualizarEstadisticas = false } = {}) {
  if (dashboardState.refreshInFlight) {
    if (actualizarEstadisticas) dashboardState.pendingStatsRefresh = true;
    return;
  }
  dashboardState.refreshInFlight = true;

  try {
    const dataChanged = await cargarIncidentes();
    dashboardState.lastLoadError = null;
    if (document.getElementById('view-historial')?.classList.contains('active')) {
      renderizarHistorial();
    }
    if (actualizarEstadisticas &&
        document.getElementById('view-estadisticas')?.classList.contains('active')) {
      renderizarEstadisticas();
    }
    if (dataChanged && document.getElementById('view-rendimiento')?.classList.contains('active')) {
      renderizarRendimiento();
    }
  } catch (error) {
    if (dashboardState.lastLoadError !== error.message) {
      notify(error.message || 'No se pudieron cargar los incidentes.', 'error');
      dashboardState.lastLoadError = error.message;
    }
    if (!dashboardState.casos.length) {
      const listContainer = document.getElementById('incidents-list');
      if (listContainer) {
        listContainer.innerHTML = '<div class="text-center py-5 text-danger">No se pudieron cargar las emergencias. Verifica tu conexión y pulsa Actualizar para volver a intentar.</div>';
      }
    }
    return false;
  } finally {
    dashboardState.refreshInFlight = false;
    const refrescarEstadisticas = dashboardState.pendingStatsRefresh && dashboardState.usuarioActual;
    dashboardState.pendingStatsRefresh = false;
    if (refrescarEstadisticas) {
      void actualizarDatosDashboard({ actualizarEstadisticas: true });
    }
  }
  return true;
}

async function activarSesionOperador(user) {
  if (user.app_metadata?.role !== 'operador') {
    throw new Error('Esta cuenta no tiene permisos de operador.');
  }
  dashboardState.usuarioActual = user.id;
  document.getElementById('login-screen')?.classList.add('hidden');
  document.getElementById('dashboard-app')?.classList.remove('hidden');

  const userLabel = document.getElementById('user-nombre');
  if (userLabel) userLabel.textContent = user.app_metadata.nombre || 'Central Chorrillos';

  suscribirNuevosIncidentes();
  await actualizarDatosDashboard();
}

// ─── Notificaciones Toast ────────────────────────────────────────────────────
function notify(msg, tipo = 'info') {
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

// ─── Cálculo Haversine de Distancia en km ─────────────────────────────────────
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio terrestre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Renderizado de la Cola de Emergencias (RF-06 & RN-01) ───────────────────

function renderizarDashboard() {
  const rawCases = obtenerCasos();

  // Filtrar activos (no cerrados)
  let activos = rawCases.filter(c => c.estado !== 'atendido' && c.estado !== 'cancelado');

  // Aplicar filtro de estado (todos, recibido, asignado, en_camino)
  if (dashboardState.filtroActual !== 'todos') {
    activos = activos.filter(c => c.estado === dashboardState.filtroActual);
  }

  // ─── REGLA DE NEGOCIO RN-01 ──────────────────────────────────────────────
  // 'violencia' y 'auxilio' SIEMPRE deben ubicarse al inicio de la cola
  activos.sort((a, b) => {
    const esCriticoA = (a.tipo === 'violencia' || a.tipo === 'auxilio') ? 1 : 2;
    const esCriticoB = (b.tipo === 'violencia' || b.tipo === 'auxilio') ? 1 : 2;

    if (esCriticoA !== esCriticoB) {
      return esCriticoA - esCriticoB; // 1 (crítico) va primero
    }
    // Si tienen la misma prioridad, ordenar por timestamp más reciente
    return new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0);
  });

  // Actualizar métricas numéricas
  actualizarMetricas(rawCases);

  // Renderizar la lista de incidentes
  const listContainer = document.getElementById('incidents-list');
  if (!listContainer) return;

  if (activos.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-shield-check display-4 text-success d-block mb-2"></i>
        <div class="h5 fw-bold text-dark">No hay emergencias pendientes</div>
        <small>Las nuevas solicitudes se reflejan en tiempo real. Si la conexión se interrumpe, pulsa Actualizar.</small>
      </div>`;
    return;
  }

  listContainer.innerHTML = activos.map(caso => {
    const cfg = TIPO_CONFIG[caso.tipo] || { icon: '🚨', badgeClass: 'badge-normal', bgClass: 'bg-light', label: caso.tipo };
    const esAlta = (caso.tipo === 'violencia' || caso.tipo === 'auxilio');
    const borderClass = esAlta ? 'prioridad-alta' : 'prioridad-normal';
    const hora = caso.timestamp ? new Date(caso.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : 'Reciente';
    const ticket = escaparHTML(caso.ticket);
    const tipo = escaparHTML(cfg.label);
    const estado = escaparHTML(caso.estado);
    const referencia = escaparHTML(caso.referencia);
    const unidad = escaparHTML(caso.unidad);

    return `
      <article class="incident-card ${borderClass}" data-ticket="${ticket}" role="listitem">
        <div class="d-flex align-items-center gap-3 flex-grow-1 min-w-0">
          <div class="inc-tipo-icon ${cfg.bgClass}" aria-hidden="true">
            ${cfg.icon}
          </div>
          <div class="inc-info">
            <div class="inc-header mb-1">
              <span class="inc-ticket">${ticket}</span>
              ${esAlta ? '<span class="badge-status badge-alta"><i class="bi bi-lightning-fill"></i> Prioridad Alta</span>' : '<span class="badge-status badge-normal">Normal</span>'}
              <span class="badge-status badge-${estado}">${estado.replace('_', ' ')}</span>
              <span class="small text-muted ms-auto"><i class="bi bi-clock me-1"></i>${hora}</span>
            </div>
            <div class="inc-tipo">${tipo}</div>
            <div class="inc-loc text-truncate">
              <i class="bi bi-geo-alt-fill text-danger me-1"></i>
              Lat: ${caso.ubicacion?.lat ? caso.ubicacion.lat.toFixed(4) : '-12.1611'}, Lng: ${caso.ubicacion?.lng ? caso.ubicacion.lng.toFixed(4) : '-77.0210'}
              ${referencia ? ` · <span class="text-dark fw-semibold">"${referencia}"</span>` : ''}
            </div>
            ${unidad ? `<div class="small text-primary fw-bold mt-1"><i class="bi bi-car-front-fill me-1"></i>Despachado a: ${unidad} (ETA: ${caso.eta_minutos || 3} min)</div>` : ''}
          </div>
        </div>

        <div class="inc-actions d-flex gap-2">
          ${caso.estado === 'recibido' ? `
            <button class="btn btn-touch-primary btn-asignar" data-action="assign" data-ticket="${ticket}">
              <i class="bi bi-send-fill me-1"></i> Despachar
            </button>` : ''}
          ${caso.estado === 'asignado' || caso.estado === 'en_camino' ? `
            <button class="btn btn-outline-success btn-sm px-3 fw-bold rounded-pill" data-action="close" data-ticket="${ticket}" style="min-height: 40px;">
              <i class="bi bi-check2-circle me-1"></i> Cerrar
            </button>` : ''}
        </div>
      </article>`;
  }).join('');
}

function actualizarMetricas(todosLosCasos) {
  const activos = todosLosCasos.filter(c => c.estado !== 'atendido' && c.estado !== 'cancelado');
  const prioridadAlta = activos.filter(c => c.tipo === 'violencia' || c.tipo === 'auxilio').length;
  const atendidos = todosLosCasos.filter(c => c.estado === 'atendido').length;

  // Unidades asignadas actualmente
  const unidadesOcupadas = new Set(activos.filter(c => c.unidad_codigo).map(c => c.unidad_codigo));
  const unidadesLibres = Math.max(0, UNIDADES_DISPONIBLES.length - unidadesOcupadas.size);

  const elAlta = document.getElementById('stat-prioridad-alta');
  const elActivos = document.getElementById('stat-total-activos');
  const elAtendidos = document.getElementById('stat-atendidos-hoy');
  const elLibres = document.getElementById('stat-unidades-disponibles');
  const elBadgeNav = document.getElementById('nav-badge-incidentes');

  if (elAlta) elAlta.textContent = prioridadAlta;
  if (elActivos) elActivos.textContent = activos.length;
  if (elAtendidos) elAtendidos.textContent = atendidos;
  if (elLibres) elLibres.textContent = unidadesLibres;
  if (elBadgeNav) elBadgeNav.textContent = activos.length;
}

// ─── Modal de Asignación y Despacho en 1 Clic (RN-02) ────────────────────────

function renderizarEvidenciaModal(caso) {
  const evidenciaContainer = document.getElementById('modal-evidencia-container');
  const notaPreview = document.getElementById('modal-nota-evidencia');
  const fotoPreview = document.getElementById('modal-foto-preview');
  const audioPreview = document.getElementById('modal-audio-preview');
  const nota = String(caso.nota_evidencia || '').trim();

  if (notaPreview) {
    notaPreview.textContent = nota ? `Evidencia escrita: ${nota}` : '';
    notaPreview.classList.toggle('hidden', !nota);
  }
  if (fotoPreview) {
    fotoPreview.removeAttribute('src');
    fotoPreview.classList.toggle('hidden', !caso.foto);
    if (caso.foto) fotoPreview.src = caso.foto;
  }
  if (audioPreview) {
    audioPreview.pause();
    audioPreview.removeAttribute('src');
    audioPreview.load();
    audioPreview.classList.toggle('hidden', !caso.audio);
    if (caso.audio) audioPreview.src = caso.audio;
  }
  if (evidenciaContainer) {
    evidenciaContainer.classList.toggle('hidden', !(nota || caso.foto || caso.audio));
  }
}

async function cargarEvidenciasIncidente(ticket) {
  const caso = dashboardState.casos.find(item => item.ticket === ticket);
  if (!caso || (!caso.tiene_foto && !caso.tiene_audio && !caso.tiene_audio_evidencia)) return;

  let evidenciaPromise = dashboardState.evidenciasPorTicket.get(ticket);
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
    dashboardState.evidenciasPorTicket.set(ticket, evidenciaPromise);
    if (dashboardState.evidenciasPorTicket.size > 8) {
      const ticketMasAntiguo = dashboardState.evidenciasPorTicket.keys().next().value;
      if (ticketMasAntiguo !== ticket) dashboardState.evidenciasPorTicket.delete(ticketMasAntiguo);
    }
  }

  try {
    const evidencia = await evidenciaPromise;
    if (dashboardState.incidenteSeleccionado?.ticket !== ticket) return;
    Object.assign(caso, evidencia);
    caso.audio = evidencia.audio_evidencia || evidencia.audio_referencia || evidencia.audio || null;
    renderizarEvidenciaModal(caso);
  } catch (error) {
    dashboardState.evidenciasPorTicket.delete(ticket);
    console.error('No se pudo cargar la evidencia del incidente:', error);
    notify(error.message || 'No se pudo cargar la evidencia del incidente.', 'error');
  }
}

window.abrirModalAsignacion = function(ticket) {
  const cases = obtenerCasos();
  const caso = cases.find(c => c.ticket === ticket);
  if (!caso) return;

  dashboardState.incidenteSeleccionado = caso;
  dashboardState.unidadSeleccionadaId = null;

  const modalTipo = document.getElementById('modal-inc-tipo');
  const modalTicket = document.getElementById('modal-inc-ticket');
  const modalPrioridad = document.getElementById('modal-inc-prioridad');
  const btnConfirmar = document.getElementById('btn-confirmar-asignacion');

  if (modalTipo) modalTipo.textContent = `${TIPO_CONFIG[caso.tipo]?.icon || '🚨'} Emergencia por ${caso.tipo.toUpperCase()}`;
  if (modalTicket) modalTicket.textContent = `Código: ${caso.ticket}`;
  renderizarEvidenciaModal(caso);
  void cargarEvidenciasIncidente(ticket);

  if (modalPrioridad) {
    const esAlta = (caso.tipo === 'violencia' || caso.tipo === 'auxilio');
    modalPrioridad.textContent = esAlta ? 'PRIORIDAD ALTA' : 'PRIORIDAD NORMAL';
    modalPrioridad.className = `badge-status ${esAlta ? 'badge-alta' : 'badge-normal'}`;
  }

  // Calcular cercanía geodésica de patrullas al incidente (RN-02: Haversine)
  const latInc = caso.ubicacion?.lat || -12.1611;
  const lngInc = caso.ubicacion?.lng || -77.0210;

  const unidadesOcupadas = new Set(obtenerCasos()
    .filter(incidente => !['atendido', 'cancelado'].includes(incidente.estado))
    .map(incidente => incidente.unidad_asignada || incidente.unidad_codigo)
    .filter(Boolean));
  const unidadesLibres = UNIDADES_DISPONIBLES.filter(unidad => !unidadesOcupadas.has(unidad.id));
  if (unidadesLibres.length === 0) {
    dashboardState.incidenteSeleccionado = null;
    notify('No hay unidades disponibles para despachar.', 'error');
    return;
  }

  const unidadesConDistancia = unidadesLibres.map(u => {
    const dist = calcularDistanciaKm(latInc, lngInc, u.lat, u.lng);
    const etaMin = Math.max(1, Math.round((dist / 30) * 60)); // ETA a 30 km/h
    return { ...u, distanciaKm: dist, etaMin: etaMin };
  });

  // Ordenar por cercanía
  unidadesConDistancia.sort((a, b) => a.distanciaKm - b.distanciaKm);

  // Renderizar opciones de patrullas
  const listEl = document.getElementById('modal-unidades-list');
  if (listEl) {
    listEl.innerHTML = unidadesConDistancia.map((u, idx) => {
      const esSugerida = (idx === 0);
      return `
        <div class="unidad-row ${esSugerida ? 'sugerida selected' : ''}" data-unidad-id="${u.id}" onclick="seleccionarUnidadModal('${u.id}')">
          <div class="unidad-row-icon"><i class="bi bi-car-front-fill text-primary"></i></div>
          <div class="unidad-row-info">
            <div class="u-nombre">${u.codigo} — ${u.nombre}</div>
            <div class="u-detalle"><i class="bi bi-geo-alt me-1"></i>Sector: ${u.sector} (${u.distanciaKm.toFixed(2)} km de distancia)</div>
          </div>
          <div class="u-eta">
            <div>${u.etaMin} min</div>
            ${esSugerida ? '<span class="sugerida-label">Sugerida</span>' : ''}
          </div>
        </div>`;
    }).join('');

    // Preseleccionar la unidad sugerida más cercana
    if (unidadesConDistancia.length > 0) {
      dashboardState.unidadSeleccionadaId = unidadesConDistancia[0].id;
      if (btnConfirmar) btnConfirmar.disabled = false;
    }
  }

  const modal = document.getElementById('modal-asignar');
  if (modal) modal.classList.remove('hidden');
  if ((caso.tiene_foto || caso.tiene_audio || caso.tiene_audio_evidencia) && !caso.foto && !caso.audio) {
    void cargarEvidenciaModal(ticket);
  }
};

window.seleccionarUnidadModal = function(unidadId) {
  dashboardState.unidadSeleccionadaId = unidadId;
  document.querySelectorAll('.unidad-row').forEach(row => {
    if (row.getAttribute('data-unidad-id') === unidadId) {
      row.classList.add('selected');
    } else {
      row.classList.remove('selected');
    }
  });

  const btnConfirmar = document.getElementById('btn-confirmar-asignacion');
  if (btnConfirmar) btnConfirmar.disabled = false;
};

async function confirmarDespacho() {
  if (!dashboardState.incidenteSeleccionado || !dashboardState.unidadSeleccionadaId) return;
  const btnConfirmar = document.getElementById('btn-confirmar-asignacion');
  if (btnConfirmar?.disabled) return;

  const ticket = dashboardState.incidenteSeleccionado.ticket;
  const unidad = UNIDADES_DISPONIBLES.find(u => u.id === dashboardState.unidadSeleccionadaId);
  if (!unidad) {
    notify('La unidad seleccionada ya no está disponible.', 'error');
    return;
  }
  const textoOriginal = btnConfirmar?.innerHTML;
  if (btnConfirmar) {
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Asignando…';
  }

  let actualizacion;
  try {
    const { data, error } = await supabaseClient
      .from('incidentes')
      .update({
        estado: 'asignado',
        unidad_asignada: unidad.id,
        unidad: `${unidad.codigo} - ${unidad.nombre}`,
        unidad_codigo: unidad.codigo,
        eta_minutos: Math.floor(Math.random() * 3) + 2,
        updated_at: new Date().toISOString()
      })
      .eq('ticket', ticket)
      .eq('estado', 'recibido')
      .select('ticket,estado,unidad_asignada,unidad,unidad_codigo,eta_minutos,updated_at')
      .single();
    if (error) throw error;
    actualizacion = data;
  } catch (error) {
    console.error('No se pudo asignar la unidad:', error);
    notify(error.message || `No se pudo despachar el incidente ${ticket}.`, 'error');
    return;
  } finally {
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      if (textoOriginal) btnConfirmar.innerHTML = textoOriginal;
    }
  }

  const caso = dashboardState.casos.find(item => item.ticket === ticket);
  if (caso && actualizacion) Object.assign(caso, actualizacion);
  cerrarModal('modal-asignar');
  renderizarVistasActivas();
  notify(`Patrulla ${unidad.codigo} despachada a ${ticket}`, 'success');
}

// ─── Modal de Cierre de Emergencia ───────────────────────────────────────────

window.abrirModalCierre = function(ticket) {
  const cases = obtenerCasos();
  const caso = cases.find(c => c.ticket === ticket);
  if (!caso) return;

  dashboardState.incidenteSeleccionado = caso;
  const obsEl = document.getElementById('cierre-observaciones');
  if (obsEl) obsEl.value = '';

  const modal = document.getElementById('modal-cierre');
  if (modal) modal.classList.remove('hidden');
};

async function confirmarCierreIncidente() {
  if (!dashboardState.incidenteSeleccionado) return;
  const btnConfirmar = document.getElementById('btn-confirmar-cierre');
  if (btnConfirmar?.disabled) return;

  const ticket = dashboardState.incidenteSeleccionado.ticket;
  const estadoSelect = document.getElementById('cierre-estado');
  const obsText = document.getElementById('cierre-observaciones');
  const estado = estadoSelect ? estadoSelect.value : 'atendido';
  const actualizadoAt = new Date().toISOString();
  const textoOriginal = btnConfirmar?.innerHTML;
  if (btnConfirmar) {
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Guardando…';
  }

  let actualizacion;
  try {
    const { data, error } = await supabaseClient
      .from('incidentes')
      .update({
        estado,
        observaciones: obsText ? obsText.value : 'Cerrado por operador',
        atendido_at: actualizadoAt,
        updated_at: actualizadoAt
      })
      .eq('ticket', ticket)
      .select('ticket,estado,observaciones,atendido_at,updated_at')
      .single();
    if (error) throw error;
    actualizacion = data;
  } catch (error) {
    console.error('No se pudo cerrar el incidente:', error);
    notify(error.message || `No se pudo cerrar el incidente ${ticket}.`, 'error');
    return;
  } finally {
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      if (textoOriginal) btnConfirmar.innerHTML = textoOriginal;
    }
  }

  const caso = dashboardState.casos.find(item => item.ticket === ticket);
  if (caso && actualizacion) Object.assign(caso, actualizacion);
  cerrarModal('modal-cierre');
  renderizarVistasActivas();
  notify(`Incidente ${ticket} cerrado exitosamente`, 'success');
}

function cerrarModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
  if (modalId === 'modal-asignar') {
    renderizarEvidenciaModal({});
    if (dashboardState.incidenteSeleccionado) {
      delete dashboardState.incidenteSeleccionado.foto;
      delete dashboardState.incidenteSeleccionado.audio;
      delete dashboardState.incidenteSeleccionado.audio_referencia;
      delete dashboardState.incidenteSeleccionado.audio_evidencia;
    }
    dashboardState.incidenteSeleccionado = null;
    dashboardState.unidadSeleccionadaId = null;
  }
}

// ─── Vistas Secundarias (Mapa, Historial, Estadísticas, Patrullas) ───────────

function cambiarVista(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('hidden');
    v.classList.remove('active');
  });

  document.querySelectorAll('.nav-item-dashboard').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-view') === viewId) {
      btn.classList.add('active');
    }
  });

  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) {
    targetView.classList.remove('hidden');
    targetView.classList.add('active');
  }

  if (viewId === 'mapa') {
    inicializarMapaTactico();
  } else if (viewId === 'historial') {
    renderizarHistorial();
  } else if (viewId === 'unidades') {
    renderizarUnidadesGrid();
  } else if (viewId === 'estadisticas') {
    renderizarEstadisticas();
  } else if (viewId === 'rendimiento') {
    renderizarRendimiento();
  }
}

function inicializarMapaTactico() {
  const container = document.getElementById('mapa-dashboard');
  if (!container) return;

  if (!dashboardState.mapaDashboard) {
    dashboardState.mapaDashboard = L.map('mapa-dashboard').setView([-12.1611, -77.0210], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(dashboardState.mapaDashboard);
  }

  // Limpiar marcadores previos
  dashboardState.markersList.forEach(m => m.remove());
  dashboardState.markersList = [];

  const cases = obtenerCasos().filter(c => c.estado !== 'atendido' && c.estado !== 'cancelado');
  cases.forEach(c => {
    const lat = c.ubicacion?.lat || -12.1611;
    const lng = c.ubicacion?.lng || -77.0210;
    const esAlta = (c.tipo === 'violencia' || c.tipo === 'auxilio');
    const color = esAlta ? '#DC2626' : '#0284C7';

    const customIcon = L.divIcon({
      html: `<div style="background:${color};color:#fff;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.15rem;box-shadow:0 3px 10px rgba(0,0,0,0.3);border:3px solid #fff;">${TIPO_CONFIG[c.tipo]?.icon || '🚨'}</div>`,
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    const marker = L.marker([lat, lng], { icon: customIcon })
      .addTo(dashboardState.mapaDashboard)
      .bindPopup(`<strong>${escaparHTML(c.ticket)}</strong><br>Emergencia: ${escaparHTML(c.tipo)}<br>Estado: ${escaparHTML(c.estado)}`);

    dashboardState.markersList.push(marker);
  });

  setTimeout(() => dashboardState.mapaDashboard.invalidateSize(), 200);
}

function renderizarHistorial() {
  const tbody = document.getElementById('historial-tbody');
  if (!tbody) return;

  const cerrados = obtenerCasos().filter(c => c.estado === 'atendido' || c.estado === 'cancelado');
  if (cerrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Aún no hay incidentes en el historial.</td></tr>';
    return;
  }

  tbody.innerHTML = cerrados.map(c => `
    <tr>
      <td><code>${escaparHTML(c.ticket)}</code></td>
      <td><strong>${escaparHTML(c.tipo.toUpperCase())}</strong></td>
      <td><span class="badge-status badge-${escaparHTML(c.estado)}">${escaparHTML(c.estado)}</span></td>
      <td>${escaparHTML(c.unidad || '—')}</td>
      <td class="small text-muted">${c.atendido_at ? new Date(c.atendido_at).toLocaleString('es-PE') : 'Reciente'}</td>
      <td class="small">${escaparHTML(c.observaciones || 'Atendido satisfactoriamente')}</td>
    </tr>`).join('');
}

function exportarHistorialExcel() {
  const casos = obtenerCasos().filter(caso =>
    ['atendido', 'cancelado', 'recibido', 'asignado', 'en_camino'].includes(caso.estado)
  );
  const limitarTextoCelda = valor => {
    let texto = String(valor ?? '').slice(0, 32767);
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
    return texto;
  };
  const fechaLocal = valor => {
    const fecha = valor ? new Date(valor) : null;
    return fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleString('es-PE') : '';
  };
  const filas = casos.map(caso => ({
    'Ticket': limitarTextoCelda(caso.ticket),
    'DNI Ciudadano': limitarTextoCelda(caso.ciudadano_dni),
    'Tipo': limitarTextoCelda(caso.tipo),
    'Prioridad': caso.prioridad === 1 ? 'Alta' : 'Normal',
    'Estado': limitarTextoCelda(caso.estado),
    'Sector Referencial': limitarTextoCelda(obtenerSectorReferencial(caso)),
    'Latitud': caso.ubicacion?.lat != null && Number.isFinite(Number(caso.ubicacion.lat)) ? Number(caso.ubicacion.lat) : '',
    'Longitud': caso.ubicacion?.lng != null && Number.isFinite(Number(caso.ubicacion.lng)) ? Number(caso.ubicacion.lng) : '',
    'Referencia Ubicación': limitarTextoCelda(caso.referencia),
    'Nota de Evidencia': limitarTextoCelda(caso.nota_evidencia),
    'Tiene Foto (Sí/No)': caso.tiene_foto ? 'Sí' : 'No',
    'Tiene Audio (Sí/No)': caso.tiene_audio || caso.tiene_audio_evidencia ? 'Sí' : 'No',
    'Unidad Asignada': limitarTextoCelda(caso.unidad || caso.unidad_codigo || caso.unidad_asignada),
    'Fecha de Registro': fechaLocal(caso.timestamp),
    'Fecha de Cierre': fechaLocal(caso.atendido_at),
    'Observaciones de Campo': limitarTextoCelda(caso.observaciones)
  }));
  const fechaArchivo = fechaLocalComoInput(new Date());
  const nombreBase = `Historial_Serenazgo_Chorrillos_${fechaArchivo}`;

  if (window.XLSX?.utils?.json_to_sheet && typeof window.XLSX.writeFile === 'function') {
    try {
      const worksheet = window.XLSX.utils.json_to_sheet(filas);
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Historial');
      window.XLSX.writeFile(workbook, `${nombreBase}.xlsx`);
      notify('El historial se descargó en formato Excel.', 'success');
      return;
    } catch (error) {
      console.warn('No se pudo crear el archivo Excel; se descargará como CSV:', error);
    }
  }

  const cabeceras = Object.keys(filas[0] || {
    'Ticket': '', 'DNI Ciudadano': '', 'Tipo': '', 'Prioridad': '', 'Estado': '',
    'Sector Referencial': '', 'Latitud': '', 'Longitud': '', 'Referencia Ubicación': '',
    'Nota de Evidencia': '', 'Tiene Foto (Sí/No)': '', 'Tiene Audio (Sí/No)': '',
    'Unidad Asignada': '', 'Fecha de Registro': '', 'Fecha de Cierre': '',
    'Observaciones de Campo': ''
  });
  const csvEscape = valor => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const contenidoCsv = [cabeceras, ...filas]
    .map(fila => cabeceras.map(cabecera =>
      csvEscape(Array.isArray(fila) ? fila[cabeceras.indexOf(cabecera)] : fila[cabecera])
    ).join(','))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${contenidoCsv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${nombreBase}.csv`;
  enlace.hidden = true;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Excel no está disponible; el historial se descargó como CSV UTF-8.', 'info');
}

function renderizarUnidadesGrid() {
  const grid = document.getElementById('unidades-grid');
  if (!grid) return;

  const cases = obtenerCasos().filter(c => c.estado !== 'atendido' && c.estado !== 'cancelado');
  const ocupadasMap = new Map();
  cases.forEach(c => {
    if (c.unidad_codigo) ocupadasMap.set(c.unidad_codigo, c.ticket);
  });

  grid.innerHTML = UNIDADES_DISPONIBLES.map(u => {
    const estaOcupada = ocupadasMap.has(u.codigo);
    return `
      <div class="col-12 col-md-6 col-xl-3">
        <div class="card-modern p-3 border-top border-4 ${estaOcupada ? 'border-warning' : 'border-success'}">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold">${u.codigo}</span>
            <span class="badge ${estaOcupada ? 'bg-warning text-dark' : 'bg-success'}">${estaOcupada ? 'En Servicio' : 'Disponible'}</span>
          </div>
          <div class="h6 fw-bold mb-1">${u.nombre}</div>
          <small class="text-muted d-block">Sector: ${u.sector}</small>
          ${estaOcupada ? `<small class="text-primary fw-bold mt-2 d-block">Atendiendo: ${escaparHTML(ocupadasMap.get(u.codigo))}</small>` : ''}
        </div>
      </div>`;
  }).join('');
}

const CENTROS_SECTOR_REFERENCIAL = [
  { nombre: 'Norte', lat: -12.1510, lng: -77.0230 },
  { nombre: 'Sur', lat: -12.1830, lng: -77.0200 },
  { nombre: 'Centro', lat: -12.1660, lng: -77.0300 },
  { nombre: 'Este', lat: -12.1650, lng: -77.0060 }
];

function obtenerSectorReferencial(caso) {
  const sectorGuardado = String(caso.sector || '').toLowerCase();
  const sectores = ['norte', 'sur', 'centro', 'este'];
  const sectorExistente = sectores.find(sector => sector === sectorGuardado);
  if (sectorExistente) {
    return sectorExistente[0].toUpperCase() + sectorExistente.slice(1);
  }

  const latValue = caso.ubicacion?.lat ?? caso.lat;
  const lngValue = caso.ubicacion?.lng ?? caso.lng;
  if (latValue === null || latValue === undefined || latValue === '' ||
      lngValue === null || lngValue === undefined || lngValue === '') {
    return 'Sin ubicación';
  }
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Sin ubicación';

  return CENTROS_SECTOR_REFERENCIAL.reduce((cercano, centro) => {
    const distancia = calcularDistanciaKm(lat, lng, centro.lat, centro.lng);
    return distancia < cercano.distancia ? { nombre: centro.nombre, distancia } : cercano;
  }, { nombre: 'Centro', distancia: Infinity }).nombre;
}

function obtenerFechaIncidente(caso) {
  const valor = caso.timestamp || caso.created_at || caso.createdAt;
  if (!valor) return null;

  const iso = typeof valor === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor)
    ? `${valor.replace(' ', 'T')}Z`
    : valor;
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function fechaLocalComoInput(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function configurarFiltrosFecha() {
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const fechaHoy = fechaLocalComoInput(hoy);
  const fechaInicioMes = fechaLocalComoInput(inicioMes);
  [
    ['filtro-fecha-inicio', fechaInicioMes],
    ['rendimiento-fecha-inicio', fechaInicioMes],
    ['filtro-fecha-fin', fechaHoy],
    ['rendimiento-fecha-fin', fechaHoy]
  ].forEach(([id, valor]) => {
    const input = document.getElementById(id);
    if (input && !input.value) input.value = valor;
  });
}

function obtenerRangoFechas(idInicio, idFin, idError) {
  const inputInicio = document.getElementById(idInicio);
  const inputFin = document.getElementById(idFin);
  const errorEl = document.getElementById(idError);
  if (!inputInicio?.value || !inputFin?.value) {
    if (errorEl) {
      errorEl.textContent = 'Selecciona las fechas Desde y Hasta para consultar el periodo.';
      errorEl.classList.remove('hidden');
    }
    return null;
  }

  const inicio = new Date(`${inputInicio.value}T00:00:00`);
  let fechaFin = inputFin.value;
  let aviso = '';
  if (inputInicio.value > inputFin.value) {
    fechaFin = inputInicio.value;
    inputFin.value = fechaFin;
    aviso = 'La fecha Hasta era anterior a Desde; se ajustó para incluir un solo día.';
  }
  const fin = new Date(`${fechaFin}T23:59:59.999`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    if (errorEl) {
      errorEl.textContent = 'El rango de fechas seleccionado no es válido.';
      errorEl.classList.remove('hidden');
    }
    return null;
  }

  if (errorEl) {
    errorEl.textContent = aviso;
    errorEl.classList.toggle('hidden', !aviso);
  }
  return { inicio, fin };
}

function obtenerRangoEstadisticas() {
  return obtenerRangoFechas('filtro-fecha-inicio', 'filtro-fecha-fin', 'estadisticas-filtro-error');
}

function obtenerDatosTendencia(inicio, fin, casos) {
  const mismoDia = inicio.getFullYear() === fin.getFullYear() &&
    inicio.getMonth() === fin.getMonth() && inicio.getDate() === fin.getDate();
  if (mismoDia) {
    const etiquetas = Array.from({ length: 24 }, (_, hora) => `${String(hora).padStart(2, '0')}:00`);
    const conteos = Array(24).fill(0);
    casos.forEach(caso => {
      const fecha = obtenerFechaIncidente(caso);
      if (fecha) conteos[fecha.getHours()] += 1;
    });
    return { etiquetas, conteos };
  }

  const etiquetas = [];
  const conteos = [];
  const conteosPorFecha = new Map();
  for (const fecha = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
    fecha <= fin;
    fecha.setDate(fecha.getDate() + 1)) {
    const clave = fechaLocalComoInput(fecha);
    etiquetas.push(`${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}`);
    conteos.push(0);
    conteosPorFecha.set(clave, conteos.length - 1);
  }
  casos.forEach(caso => {
    const fecha = obtenerFechaIncidente(caso);
    if (!fecha) return;
    const indice = conteosPorFecha.get(fechaLocalComoInput(fecha));
    if (indice !== undefined) conteos[indice] += 1;
  });
  return { etiquetas, conteos };
}

function renderizarEstadisticas() {
  const sectorSeleccionado = document.getElementById('filtro-sector-estadisticas')?.value || 'todos';
  const rango = obtenerRangoEstadisticas();
  if (!rango) return;
  const { inicio, fin } = rango;
  const casosPeriodo = obtenerCasos().filter(caso => {
    const fecha = obtenerFechaIncidente(caso);
    return fecha && fecha >= inicio && fecha <= fin;
  });
  const casosFiltrados = casosPeriodo.filter(caso =>
    sectorSeleccionado === 'todos' || obtenerSectorReferencial(caso) === sectorSeleccionado
  );
  const atendidos = casosFiltrados.filter(caso => caso.estado === 'atendido');
  const pendientes = casosFiltrados.filter(caso => !['atendido', 'cancelado'].includes(caso.estado));

  document.getElementById('kpi-reportes-registrados').textContent = casosFiltrados.length;
  document.getElementById('kpi-reportes-pendientes').textContent = pendientes.length;
  document.getElementById('kpi-reportes-atendidos').textContent = atendidos.length;

  const tiemposSolucion = atendidos.map(caso => {
    const creado = obtenerFechaIncidente(caso);
    const cerrado = caso.atendido_at ? new Date(caso.atendido_at) : null;
    if (!creado || !cerrado || Number.isNaN(cerrado.getTime())) return null;
    const minutos = (cerrado - creado) / 60000;
    return Number.isFinite(minutos) && minutos >= 0 ? minutos : null;
  }).filter(minutos => minutos !== null);
  const promedio = tiemposSolucion.length
    ? (tiemposSolucion.reduce((total, minutos) => total + minutos, 0) / tiemposSolucion.length).toFixed(1)
    : '—';
  document.getElementById('kpi-tiempo-promedio').innerHTML = `${promedio} <span class="fs-6">min</span>`;

  const aviso = document.getElementById('estadisticas-error');
  if (typeof Chart === 'undefined') {
    if (aviso) {
      aviso.textContent = 'No se pudieron cargar los gráficos. Verifica tu conexión a Internet y vuelve a actualizar.';
      aviso.classList.remove('hidden');
    }
    return;
  }
  if (aviso) aviso.classList.add('hidden');
  Chart.defaults.color = document.documentElement.classList.contains('high-contrast') ? '#FFFFFF' : '#475569';
  Chart.defaults.borderColor = document.documentElement.classList.contains('high-contrast') ? '#FFFF00' : '#CBD5E1';

  const renderizarGrafico = (clave, canvasId, tipo, datos, opciones) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    dashboardState.chartInstances[clave]?.destroy();
    dashboardState.chartInstances[clave] = new Chart(canvas, {
      type: tipo,
      data: datos,
      options: { responsive: true, maintainAspectRatio: false, ...opciones }
    });
  };

  const categorias = [
    { key: 'violencia', label: 'Violencia' },
    { key: 'robo', label: 'Robo' },
    { key: 'accidente', label: 'Accidente' },
    { key: 'auxilio', label: 'Auxilio' },
    { key: 'otros', label: 'Otros' }
  ];
  renderizarGrafico('categorias', 'grafico-categorias', 'doughnut', {
    labels: categorias.map(item => item.label),
    datasets: [{
      data: categorias.map(item => casosFiltrados.filter(caso => caso.tipo === item.key).length),
      backgroundColor: ['#DC2626', '#F59E0B', '#0284C7', '#059669', '#64748B'],
      borderWidth: 1
    }]
  }, { plugins: { legend: { position: 'bottom' } } });

  const sectores = ['Norte', 'Sur', 'Centro', 'Este', 'Sin ubicación'];
  renderizarGrafico('sectores', 'grafico-sectores', 'bar', {
    labels: sectores,
    datasets: [{
      label: 'Reportes',
      data: sectores.map(sector => casosFiltrados.filter(caso => obtenerSectorReferencial(caso) === sector).length),
      backgroundColor: '#0A74DA',
      borderRadius: 6
    }]
  }, { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } });

  const tendencia = obtenerDatosTendencia(inicio, fin, casosFiltrados);
  renderizarGrafico('tendencia', 'grafico-tendencia', 'line', {
    labels: tendencia.etiquetas,
    datasets: [{
      label: 'Reportes',
      data: tendencia.conteos,
      borderColor: '#0A74DA',
      backgroundColor: 'rgba(10, 116, 218, 0.15)',
      fill: true,
      tension: 0.3
    }]
  }, { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
}

function calcularTiempoResolucion(caso) {
  const registrado = obtenerFechaIncidente(caso);
  const cierre = caso.atendido_at ? new Date(caso.atendido_at) : null;
  if (!registrado || !cierre || Number.isNaN(cierre.getTime())) return null;
  const minutos = (cierre - registrado) / 60000;
  return Number.isFinite(minutos) && minutos >= 0 ? minutos : null;
}

function renderizarRendimiento() {
  const rango = obtenerRangoFechas(
    'rendimiento-fecha-inicio',
    'rendimiento-fecha-fin',
    'rendimiento-filtro-error'
  );
  if (!rango) return;

  const unidadSeleccionada = document.getElementById('filtro-unidad-rendimiento')?.value || 'todas';
  const casosPeriodo = obtenerCasos().filter(caso => {
    const fecha = obtenerFechaIncidente(caso);
    return fecha && fecha >= rango.inicio && fecha <= rango.fin;
  });
  const asignados = casosPeriodo.filter(caso => caso.unidad_asignada || caso.unidad_codigo);
  const unidades = unidadSeleccionada === 'todas'
    ? UNIDADES_DISPONIBLES
    : UNIDADES_DISPONIBLES.filter(unidad => unidad.codigo === unidadSeleccionada);
  const asignadosSeleccionados = unidadSeleccionada === 'todas'
    ? asignados
    : asignados.filter(caso => (caso.unidad_asignada || caso.unidad_codigo) === unidadSeleccionada);
  const casosUnidad = (unidad) => asignados.filter(caso =>
    (caso.unidad_asignada || caso.unidad_codigo) === unidad.codigo
  );
  const atendidos = asignadosSeleccionados.filter(caso => caso.estado === 'atendido');
  const tiempos = atendidos.map(calcularTiempoResolucion).filter(Number.isFinite);
  const promedioGlobal = tiempos.length
    ? (tiempos.reduce((suma, tiempo) => suma + tiempo, 0) / tiempos.length).toFixed(1)
    : '—';

  document.getElementById('kpi-rend-asignados').textContent = asignadosSeleccionados.length;
  document.getElementById('kpi-rend-atendidos').textContent = atendidos.length;
  document.getElementById('kpi-rend-efectividad').textContent =
    `${asignadosSeleccionados.length ? (atendidos.length / asignadosSeleccionados.length * 100).toFixed(1) : '0.0'}%`;
  document.getElementById('kpi-rend-tiempo').textContent = promedioGlobal;
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = document.documentElement.classList.contains('high-contrast') ? '#FFFFFF' : '#475569';
    Chart.defaults.borderColor = document.documentElement.classList.contains('high-contrast') ? '#FFFF00' : '#CBD5E1';
  }
  const chartError = document.getElementById('rendimiento-chart-error');
  if (chartError) {
    chartError.textContent = typeof Chart === 'undefined'
      ? 'No se pudieron cargar los gráficos. Verifica tu conexión a Internet.'
      : '';
    chartError.classList.toggle('hidden', typeof Chart !== 'undefined');
  }

  const renderizarGrafico = (clave, canvasId, tipo, datos, opciones) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const existente = dashboardState.chartInstances[clave];
    if (existente && existente.config.type === tipo) {
      existente.data = datos;
      existente.options = { responsive: true, maintainAspectRatio: false, ...opciones };
      existente.update('none');
      return;
    }
    existente?.destroy();
    dashboardState.chartInstances[clave] = new Chart(canvas, {
      type: tipo,
      data: datos,
      options: { responsive: true, maintainAspectRatio: false, ...opciones }
    });
  };

  const resumen = unidades.map(unidad => {
    const casos = casosUnidad(unidad);
    const atendidosUnidad = casos.filter(caso => caso.estado === 'atendido');
    const cancelados = casos.filter(caso => caso.estado === 'cancelado').length;
    const enCurso = casos.filter(caso => ['asignado', 'en_camino'].includes(caso.estado)).length;
    const duraciones = atendidosUnidad.map(calcularTiempoResolucion).filter(Number.isFinite);
    const promedio = duraciones.length
      ? duraciones.reduce((suma, tiempo) => suma + tiempo, 0) / duraciones.length
      : null;
    return {
      unidad,
      asignados: casos.length,
      atendidos: atendidosUnidad.length,
      cancelados,
      enCurso,
      efectividad: casos.length ? atendidosUnidad.length / casos.length * 100 : 0,
      promedio
    };
  });
  const etiquetas = resumen.map(item => item.unidad.codigo);

  renderizarGrafico('rendimiento-unidades', 'grafico-rendimiento-unidades', 'bar', {
    labels: etiquetas,
    datasets: [
      { label: 'Atendidos', data: resumen.map(item => item.atendidos), backgroundColor: '#059669' },
      { label: 'En curso', data: resumen.map(item => item.enCurso), backgroundColor: '#D97706' },
      { label: 'Cancelados', data: resumen.map(item => item.cancelados), backgroundColor: '#64748B' }
    ]
  }, {
    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    plugins: { legend: { position: 'bottom' } }
  });

  renderizarGrafico('rendimiento-tiempos', 'grafico-rendimiento-tiempos', 'bar', {
    labels: etiquetas,
    datasets: [{
      label: 'Minutos promedio',
      data: resumen.map(item => item.promedio === null ? null : Number(item.promedio.toFixed(1))),
      backgroundColor: '#1565C0'
    }]
  }, {
    indexAxis: 'y',
    scales: { x: { beginAtZero: true } },
    plugins: { legend: { display: false } }
  });

  const casosAtendidosSeleccionados = atendidos.filter(caso =>
    unidadSeleccionada === 'todas' ||
    (caso.unidad_asignada || caso.unidad_codigo) === unidadSeleccionada
  );
  const categorias = [
    { key: 'violencia', label: 'Violencia' },
    { key: 'robo', label: 'Robo' },
    { key: 'accidente', label: 'Accidente' },
    { key: 'auxilio', label: 'Auxilio' },
    { key: 'otros', label: 'Otros' }
  ];
  renderizarGrafico('rendimiento-tipos', 'grafico-rendimiento-tipos', 'doughnut', {
    labels: categorias.map(item => item.label),
    datasets: [{
      data: categorias.map(item => casosAtendidosSeleccionados.filter(caso => caso.tipo === item.key).length),
      backgroundColor: ['#DC2626', '#F59E0B', '#0284C7', '#059669', '#64748B']
    }]
  }, { plugins: { legend: { position: 'bottom' } } });

  const tbody = document.getElementById('tabla-rendimiento-tbody');
  if (tbody) {
    tbody.innerHTML = resumen.map(item => `
      <tr>
        <td><code>${escaparHTML(item.unidad.codigo)}</code></td>
        <td>${escaparHTML(item.unidad.nombre)}</td>
        <td>${escaparHTML(item.unidad.sector)}</td>
        <td>${item.asignados}</td>
        <td>${item.atendidos}</td>
        <td>${item.cancelados}</td>
        <td>${item.efectividad.toFixed(1)}%</td>
        <td>${item.promedio === null ? '—' : item.promedio.toFixed(1)}</td>
      </tr>`).join('');
  }
}

// ─── Inicialización y Login ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  configurarFiltrosFecha();
  document.addEventListener('accessibilitypreferenceschange', () => {
    if (document.getElementById('view-estadisticas')?.classList.contains('active')) {
      renderizarEstadisticas();
    }
    if (document.getElementById('view-rendimiento')?.classList.contains('active')) {
      renderizarRendimiento();
    }
  });

  // 1. Inicio de sesión de Operador con Supabase Auth
  const formLogin = document.getElementById('login-form');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('login-error');
      const button = document.getElementById('btn-login');
      const username = document.getElementById('login-usuario')?.value.trim() || '';
      const password = document.getElementById('login-password')?.value || '';
      if (errorEl) errorEl.classList.add('hidden');
      if (button) button.disabled = true;

      try {
        if (!supabaseClient) throw new Error('No se pudo cargar la librería cliente de Supabase.');
        const email = username.includes('@') ? username : `${username}@personal.serenazgo.invalid`;
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user?.app_metadata?.role !== 'operador') {
          await supabaseClient.auth.signOut({ scope: 'local' });
          throw new Error('Esta cuenta no tiene permisos de operador.');
        }
        await activarSesionOperador(data.user);
      } catch (error) {
        console.error('No se pudo iniciar sesión como operador:', error);
        if (errorEl) {
          errorEl.textContent = error.message || 'No se pudo iniciar sesión.';
          errorEl.classList.remove('hidden');
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  // 2. Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (dashboardState.realtimeChannel && supabaseClient) {
      const canal = dashboardState.realtimeChannel;
      dashboardState.realtimeChannel = null;
      void supabaseClient.removeChannel(canal).then(estado => {
        if (estado !== 'ok') console.warn('No se pudo cerrar el canal Realtime del operador:', estado);
      }).catch(error => console.error('Error al cerrar el canal Realtime del operador:', error));
    }
    dashboardState.usuarioActual = null;
    dashboardState.casos = [];
    dashboardState.pendingStatsRefresh = false;
    dashboardState.evidenciasPorTicket.clear();
    cerrarModal('modal-asignar');
    cerrarModal('modal-cierre');
    document.getElementById('dashboard-app')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
      if (error) console.error('No se pudo cerrar la sesión de operador:', error);
    }
  });

  // 3. Botón de Actualizar manual
  document.getElementById('btn-refresh')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Actualizando…</span>';
    try {
      const actualizado = await actualizarDatosDashboard({ actualizarEstadisticas: true });
      if (actualizado) notify('Datos actualizados correctamente.', 'success');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
    }
  });

  // 4. Filtros de Estado
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dashboardState.filtroActual = btn.getAttribute('data-filter');
      renderizarDashboard();
    });
  });

  document.getElementById('incidents-list')?.addEventListener('click', event => {
    const actionButton = event.target.closest('button[data-action][data-ticket]');
    if (!actionButton) return;
    const { action, ticket } = actionButton.dataset;
    if (action === 'assign') window.abrirModalAsignacion(ticket);
    else if (action === 'close') window.abrirModalCierre(ticket);
  });

  // 5. Navegación entre Módulos del Sidebar
  document.querySelectorAll('.nav-item-dashboard').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) cambiarVista(view);
    });
  });

  ['filtro-fecha-inicio', 'filtro-fecha-fin', 'filtro-sector-estadisticas'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderizarEstadisticas);
  });
  ['filtro-unidad-rendimiento', 'rendimiento-fecha-inicio', 'rendimiento-fecha-fin'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderizarRendimiento);
  });
  document.getElementById('btn-exportar-excel')?.addEventListener('click', exportarHistorialExcel);

  // 6. Confirmación de Despacho y Cierre
  document.getElementById('btn-confirmar-asignacion')?.addEventListener('click', confirmarDespacho);
  document.getElementById('btn-cerrar-modal')?.addEventListener('click', () => cerrarModal('modal-asignar'));
  document.getElementById('btn-cancelar-asignacion')?.addEventListener('click', () => cerrarModal('modal-asignar'));

  document.getElementById('btn-confirmar-cierre')?.addEventListener('click', confirmarCierreIncidente);
  document.getElementById('btn-cerrar-modal-cierre')?.addEventListener('click', () => cerrarModal('modal-cierre'));
  document.getElementById('btn-cancelar-cierre')?.addEventListener('click', () => cerrarModal('modal-cierre'));

  if (!supabaseClient) {
    console.error('No se pudo cargar la librería cliente de Supabase.');
  } else {
    supabaseClient.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      const user = data.session?.user;
      if (user?.app_metadata?.role === 'operador') {
        await activarSesionOperador(user);
      }
    }).catch(error => {
      console.error('No se pudo restaurar la sesión del operador:', error);
    });
  }
  console.log('Módulo Operador Dashboard inicializado con persistencia Supabase.');
});
