/**
 * public/js/dashboard.js
 * Lógica Frontend del Rol Operador Central — Sistema Inclusivo de Serenazgo
 * Gestión en Tiempo Real de Incidentes en Supabase
 * Regla de Negocio RN-01: Priorización automática de Violencia y Auxilio en la cola
 */

'use strict';

const supabaseUrl = 'https://nazqgqiyluoqytgwyoga.supabase.co';
const supabaseKey = 'sb_publishable_CdzSpjn1Me7fxnKJ7VOCzQ_tWzoLYVu';
const supabaseClient = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'serenazgo-operador-auth' }
  })
  : null;

// ─── Estado Local del Operador ───────────────────────────────────────────────
const dashboardState = {
  usuarioActual: null,
  filtroActual: 'todos',
  incidenteSeleccionado: null,
  unidadSeleccionadaId: null,
  mapaDashboard: null,
  markersList: [],
  pollingInterval: null,
  chartInstances: {},
  casos: [],
  lastLoadError: null,
  realtimeChannel: null,
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

async function cargarIncidentes() {
  try {
    if (!supabaseClient) {
      throw new Error('No se pudo cargar la librería cliente de Supabase.');
    }
    const { data, error } = await supabaseClient
      .from('incidentes')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) throw error;
    dashboardState.casos = data || [];
    renderizarDashboard();
  } catch (error) {
    console.error('No se pudieron cargar los incidentes desde Supabase:', error);
    throw error;
  }
}

async function actualizarDatosDashboard({ actualizarEstadisticas = false } = {}) {
  try {
    await cargarIncidentes();
    dashboardState.lastLoadError = null;
    if (document.getElementById('view-historial')?.classList.contains('active')) {
      renderizarHistorial();
    }
    if (actualizarEstadisticas &&
        document.getElementById('view-estadisticas')?.classList.contains('active')) {
      renderizarEstadisticas();
    }
  } catch (error) {
    if (dashboardState.lastLoadError !== error.message) {
      notify(error.message || 'No se pudieron cargar los incidentes.', 'error');
      dashboardState.lastLoadError = error.message;
    }
  }
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

  await actualizarDatosDashboard();
  await suscribirNuevosIncidentes();
  if (dashboardState.pollingInterval) clearInterval(dashboardState.pollingInterval);
  dashboardState.pollingInterval = setInterval(actualizarDatosDashboard, 2000);
}

async function suscribirNuevosIncidentes() {
  if (!supabaseClient) return;
  await desuscribirIncidentes();

  dashboardState.realtimeChannel = supabaseClient
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'incidentes' },
      payload => {
        if (payload.eventType === 'INSERT') {
          console.log('Nuevo incidente detectado:', payload.new);
          notify(`¡Nueva alerta entrante! Ticket: ${payload.new.ticket}`, 'error');
        }
        void actualizarDatosDashboard();
      }
    )
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Falló la suscripción Realtime de incidentes:', error);
        notify('Se perdió la conexión en tiempo real. Se intentará reconectar.', 'error');
      }
    });
}

async function desuscribirIncidentes() {
  const channel = dashboardState.realtimeChannel;
  dashboardState.realtimeChannel = null;
  if (!channel || !supabaseClient) return;
  const status = await supabaseClient.removeChannel(channel);
  if (status !== 'ok') {
    console.warn('No se pudo cerrar el canal Realtime del dashboard:', status);
  }
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
        <small>Las nuevas solicitudes ciudadanas ingresarán automáticamente aquí en tiempo real.</small>
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
  const evidenciaContainer = document.getElementById('modal-evidencia-container');
  const referenciaCiudadano = document.getElementById('modal-referencia-ciudadano');
  const descripcionEvidencia = document.getElementById('modal-descripcion-evidencia');
  const observacionesCiudadano = document.getElementById('modal-observaciones-ciudadano');
  const fotoPreview = document.getElementById('modal-foto-preview');
  const audioPreview = document.getElementById('modal-audio-preview');

  if (modalTipo) modalTipo.textContent = `${TIPO_CONFIG[caso.tipo]?.icon || '🚨'} Emergencia por ${caso.tipo.toUpperCase()}`;
  if (modalTicket) modalTicket.textContent = `Código: ${caso.ticket}`;
  if (fotoPreview) {
    fotoPreview.removeAttribute('src');
    fotoPreview.classList.add('hidden');
  }
  if (audioPreview) {
    audioPreview.pause();
    audioPreview.removeAttribute('src');
    audioPreview.load();
    audioPreview.classList.add('hidden');
  }
  if (descripcionEvidencia) {
    descripcionEvidencia.textContent = caso.descripcion_evidencia || '';
    descripcionEvidencia.classList.toggle('hidden', !caso.descripcion_evidencia);
  }
  if (referenciaCiudadano) {
    referenciaCiudadano.textContent = caso.referencia ? `Referencia: ${caso.referencia}` : '';
    referenciaCiudadano.classList.toggle('hidden', !caso.referencia);
  }
  if (observacionesCiudadano) {
    observacionesCiudadano.textContent = caso.observaciones_ciudadano
      ? `Anotaciones del ciudadano:\n${caso.observaciones_ciudadano}`
      : '';
    observacionesCiudadano.classList.toggle('hidden', !caso.observaciones_ciudadano);
  }

  let tieneEvidencia = !!(
    caso.referencia || caso.descripcion_evidencia || caso.observaciones_ciudadano
  );
  if (caso.foto && fotoPreview) {
    fotoPreview.src = caso.foto;
    fotoPreview.classList.remove('hidden');
    tieneEvidencia = true;
  }
  if (caso.audio && audioPreview) {
    audioPreview.src = caso.audio;
    audioPreview.classList.remove('hidden');
    tieneEvidencia = true;
  }
  if (evidenciaContainer) {
    evidenciaContainer.classList.toggle('hidden', !tieneEvidencia);
  }

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

  const ticket = dashboardState.incidenteSeleccionado.ticket;
  const unidad = UNIDADES_DISPONIBLES.find(u => u.id === dashboardState.unidadSeleccionadaId);
  if (!unidad) {
    notify('La unidad seleccionada ya no está disponible.', 'error');
    return;
  }
  try {
    const { error } = await supabaseClient
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
      .select('ticket')
      .single();
    if (error) throw error;
    notify(`Patrulla ${unidad.codigo} despachada a ${ticket}`, 'success');
  } catch (error) {
    console.error('No se pudo asignar la unidad:', error);
    notify(error.message || `No se pudo despachar el incidente ${ticket}.`, 'error');
    return;
  }

  cerrarModal('modal-asignar');
  await actualizarDatosDashboard();
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

  const ticket = dashboardState.incidenteSeleccionado.ticket;
  const estadoSelect = document.getElementById('cierre-estado');
  const obsText = document.getElementById('cierre-observaciones');
  const estado = estadoSelect ? estadoSelect.value : 'atendido';
  const actualizadoAt = new Date().toISOString();
  try {
    const { error } = await supabaseClient
      .from('incidentes')
      .update({
        estado,
        observaciones: obsText ? obsText.value : 'Cerrado por operador',
        atendido_at: actualizadoAt,
        updated_at: actualizadoAt
      })
      .eq('ticket', ticket)
      .select('ticket')
      .single();
    if (error) throw error;
    notify(`Incidente ${ticket} cerrado exitosamente`, 'success');
  } catch (error) {
    console.error('No se pudo cerrar el incidente:', error);
    notify(error.message || `No se pudo cerrar el incidente ${ticket}.`, 'error');
    return;
  }

  cerrarModal('modal-cierre');
  await actualizarDatosDashboard();
}

function cerrarModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
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

function obtenerRangoEstadisticas(periodo, ahora = new Date()) {
  const inicio = new Date(ahora);
  inicio.setHours(0, 0, 0, 0);

  if (periodo === 'semana') {
    const diasDesdeLunes = (inicio.getDay() + 6) % 7;
    inicio.setDate(inicio.getDate() - diasDesdeLunes);
  } else if (periodo === 'mes') {
    inicio.setDate(1);
  }

  const fin = new Date(inicio);
  if (periodo === 'hoy') fin.setDate(fin.getDate() + 1);
  else if (periodo === 'semana') fin.setDate(fin.getDate() + 7);
  else fin.setMonth(fin.getMonth() + 1);
  return { inicio, fin };
}

function obtenerDatosTendencia(periodo, casos, inicio) {
  let etiquetas;
  let claveFecha;

  if (periodo === 'hoy') {
    etiquetas = Array.from({ length: 24 }, (_, hora) => `${String(hora).padStart(2, '0')}:00`);
    claveFecha = fecha => fecha.getHours();
  } else if (periodo === 'semana') {
    etiquetas = Array.from({ length: 7 }, (_, dia) => {
      const fecha = new Date(inicio);
      fecha.setDate(fecha.getDate() + dia);
      return fecha.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' });
    });
    claveFecha = fecha => Math.floor((new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) - inicio) / 86400000);
  } else {
    const diasDelMes = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0).getDate();
    etiquetas = Array.from({ length: diasDelMes }, (_, dia) => String(dia + 1));
    claveFecha = fecha => fecha.getDate() - 1;
  }

  const conteos = Array(etiquetas.length).fill(0);
  casos.forEach(caso => {
    const fecha = obtenerFechaIncidente(caso);
    if (!fecha) return;
    const indice = claveFecha(fecha);
    if (Number.isInteger(indice) && indice >= 0 && indice < conteos.length) {
      conteos[indice] += 1;
    }
  });
  return { etiquetas, conteos };
}

function renderizarEstadisticas() {
  const periodo = document.getElementById('filtro-periodo-estadisticas')?.value || 'hoy';
  const sectorSeleccionado = document.getElementById('filtro-sector-estadisticas')?.value || 'todos';
  const { inicio, fin } = obtenerRangoEstadisticas(periodo);
  const casosPeriodo = obtenerCasos().filter(caso => {
    const fecha = obtenerFechaIncidente(caso);
    return fecha && fecha >= inicio && fecha < fin;
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

  const tendencia = obtenerDatosTendencia(periodo, casosFiltrados, inicio);
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

// ─── Inicialización y Login ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

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
          await supabaseClient.auth.signOut();
          throw new Error('Esta cuenta no tiene permisos de operador.');
        }
        await activarSesionOperador(data.user);
      } catch (error) {
        console.error('No se pudo iniciar sesión como operador:', error);
        if (errorEl) {
          errorEl.textContent = error.status === 504
            ? 'El servicio de autenticación de Supabase agotó el tiempo de respuesta (HTTP 504). Inténtalo nuevamente; si persiste, revisa el estado del proyecto en Supabase.'
            : error.status >= 500
              ? `El servicio de autenticación de Supabase no está disponible (HTTP ${error.status}). Inténtalo nuevamente.`
              : error.message || 'No se pudo iniciar sesión.';
          errorEl.classList.remove('hidden');
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  // 2. Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (dashboardState.pollingInterval) clearInterval(dashboardState.pollingInterval);
    await desuscribirIncidentes();
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) console.error('No se pudo cerrar la sesión de operador:', error);
    }
    document.getElementById('dashboard-app')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
  });

  // 3. Botón de Actualizar manual
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    await actualizarDatosDashboard({ actualizarEstadisticas: true });
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

  ['filtro-periodo-estadisticas', 'filtro-sector-estadisticas'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderizarEstadisticas);
  });

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
