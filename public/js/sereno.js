/**
 * public/js/sereno.js
 * Lógica Frontend del Rol Serenazgo en Campo — Sistema Inclusivo de Atención
 * Recepción en Tiempo Real de Asignaciones desde Supabase
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
  mapaSereno: null,
  markerAgente: null,
  markerIncidente: null,
  pollingInterval: null,
  posicionAgente: { lat: -12.1620, lng: -77.0225 }, // Posición base en Chorrillos
  lastLoadError: null,
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

// ─── Monitoreo de Asignación en Tiempo Real ──────────────────────────────────

async function verificarAsignacionesAgente() {
  if (!supabaseClient) {
    mostrarToast('Configura Supabase antes de consultar los despachos.', 'error');
    return;
  }
  const { data: miCaso, error } = await supabaseClient
    .from('incidentes')
    .select()
    .eq('unidad_asignada', serenoState.agenteCodigo)
    .neq('estado', 'atendido')
    .neq('estado', 'cancelado')
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
  const cases = miCaso ? [miCaso] : [];

  if (miCaso) {
    renderizarEmergenciaAsignada(miCaso);
  } else {
    renderizarSinAsignacion();
  }

  // Actualizar también la lista del sector si la pantalla está visible
  renderizarSectorList(cases);
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
  renderizarEvidenciasAsignacion(caso);

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
  const fotoContainer = document.getElementById('asignacion-foto-container');
  const foto = document.getElementById('asignacion-foto');
  const audioReferenciaContainer = document.getElementById('asignacion-audio-referencia-container');
  const audioReferencia = document.getElementById('asignacion-audio-referencia');
  const audioEvidenciaContainer = document.getElementById('asignacion-audio-evidencia-container');
  const audioEvidencia = document.getElementById('asignacion-audio-evidencia');

  if (!container || !referencia || !fotoContainer || !foto ||
      !audioReferenciaContainer || !audioReferencia || !audioEvidenciaContainer || !audioEvidencia) return;

  const nota = String(caso.referencia || caso.referencia_texto || '').trim();
  referencia.textContent = nota ? `Anotación: ${nota}` : '';
  referencia.classList.toggle('hidden', !nota);

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

  container.classList.toggle('hidden', !(nota || fotoSrc || audioReferenciaSrc || audioEvidenciaSrc));
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
      .bindPopup('<strong>Mi Patrulla (SR-01)</strong>');
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
    mostrarToast('🚔 Marcado como "En Camino". Notificado a la Central y al Ciudadano', 'info');
    vibrarAlerta([80]);
    await verificarAsignacionesAgente();
  } catch (error) {
    console.error('No se pudo actualizar el estado del incidente:', error);
    mostrarToast(error.message || 'No se pudo cambiar el estado a En Camino.', 'error');
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
  }

  const modal = document.getElementById('modal-cierre-sereno');
  if (modal) modal.classList.add('hidden');
  await verificarAsignacionesAgente();
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
        const metadata = data.user?.app_metadata || {};
        if (metadata.role !== 'sereno' || !metadata.unit_code) {
          await supabaseClient.auth.signOut();
          throw new Error('Esta cuenta no tiene permisos de unidad de campo.');
        }

        serenoState.agenteCodigo = metadata.unit_code;
        serenoState.agenteNombre = metadata.nombre || `Patrulla ${metadata.unit_code}`;
        serenoState.userId = data.user.id;

        document.getElementById('screen-login-sereno')?.classList.remove('active');
        document.getElementById('screen-login-sereno')?.classList.add('hidden');
        document.getElementById('sereno-header')?.classList.remove('hidden');
        document.getElementById('sereno-bottom-nav')?.classList.remove('hidden');

        const nombreEl = document.getElementById('sereno-agente-nombre');
        const perfilNombre = document.getElementById('perfil-nombre');
        if (nombreEl) nombreEl.textContent = serenoState.agenteNombre;
        if (perfilNombre) perfilNombre.textContent = `${serenoState.agenteNombre} (${serenoState.agenteCodigo})`;

        cambiarPantallaSereno('screen-asignacion');
        await verificarAsignacionesAgente();

        if (serenoState.pollingInterval) clearInterval(serenoState.pollingInterval);
        serenoState.pollingInterval = setInterval(verificarAsignacionesAgente, 2000);
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
    if (serenoState.pollingInterval) clearInterval(serenoState.pollingInterval);
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) console.error('No se pudo cerrar la sesión de agente:', error);
    }
    location.reload();
  });

  if (!supabaseClient) {
    console.error('No se pudo cargar la librería cliente de Supabase.');
  }
  console.log('Módulo Serenazgo en Campo inicializado con persistencia Supabase.');
});
