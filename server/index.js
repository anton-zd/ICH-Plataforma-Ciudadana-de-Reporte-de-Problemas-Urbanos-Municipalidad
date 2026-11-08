// server/index.js
// Servidor principal Express - Sistema de Serenazgo Chorrillos

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const multer     = require('multer');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb }  = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Configuración de Multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|mp3|ogg|wav|webm|m4a/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Calcula distancia Haversine entre dos puntos GPS (en km) */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** Genera número de ticket legible */
function generarTicket() {
  const db  = getDb();
  const año = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) as c FROM incidentes').get();
  const num = String(row.c + 1).padStart(5, '0');
  return `INC-${año}-${num}`;
}

/** Determina prioridad: Alta(1) = violencia | auxilio; Normal(2) = robo | accidente */
function calcularPrioridad(tipo) {
  return ['violencia', 'auxilio'].includes(tipo) ? 1 : 2;
}

/** Registra en historial_estados */
function registrarHistorial(db, incidenteId, estadoAnterior, estadoNuevo, unidadId, descripcion) {
  db.prepare(`
    INSERT INTO historial_estados (incidente_id, estado_anterior, estado_nuevo, unidad_id, descripcion)
    VALUES (?, ?, ?, ?, ?)
  `).run(incidenteId, estadoAnterior, estadoNuevo, unidadId || null, descripcion || null);
}

function validarCredencialesCiudadano(dni, pin) {
  return typeof dni === 'string' && /^\d{8}$/.test(dni) &&
    typeof pin === 'string' && /^\d{4}$/.test(pin);
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificarPin(pin, almacenado) {
  const [salt, hash] = String(almacenado || '').split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(hash || '')) return false;
  const esperado = Buffer.from(hash, 'hex');
  const calculado = crypto.scryptSync(pin, salt, esperado.length);
  return crypto.timingSafeEqual(calculado, esperado);
}

// ═════════════════════════════════════════════════════════════════════════════
//  RUTAS DE INCIDENTES
// ═════════════════════════════════════════════════════════════════════════════

// ─── Acceso rápido de ciudadanos ────────────────────────────────────────────

app.post('/api/ciudadanos/registro', (req, res) => {
  const { dni, pin } = req.body;
  if (!validarCredencialesCiudadano(dni, pin)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos y el PIN, 4.' });
  }

  try {
    const db = getDb();
    db.prepare('INSERT INTO ciudadanos (dni, pin) VALUES (?, ?)').run(dni, hashPin(pin));
    res.status(201).json({ success: true, dni });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe una cuenta registrada con ese DNI.' });
    }
    console.error('Error al registrar ciudadano:', err);
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  }
});

app.post('/api/ciudadanos/login', (req, res) => {
  const { dni, pin } = req.body;
  if (!validarCredencialesCiudadano(dni, pin)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos y el PIN, 4.' });
  }

  try {
    const db = getDb();
    const ciudadano = db.prepare('SELECT dni, pin FROM ciudadanos WHERE dni = ?').get(dni);
    if (!ciudadano || !verificarPin(pin, ciudadano.pin)) {
      return res.status(401).json({ error: 'DNI o PIN incorrectos.' });
    }
    res.json({ success: true, dni: ciudadano.dni });
  } catch (err) {
    console.error('Error al iniciar sesión de ciudadano:', err);
    res.status(500).json({ error: 'No se pudo validar el acceso.' });
  }
});

/**
 * POST /api/incidentes
 * Crea un nuevo reporte de emergencia (RF-01, RF-02, RF-03, RN-01, RN-03, RN-04)
 */
app.post('/api/incidentes',
  upload.fields([
    { name: 'evidencia_foto',  maxCount: 1 },
    { name: 'evidencia_audio', maxCount: 1 },
    { name: 'referencia_voz',  maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const db = getDb();
      const { tipo, lat, lng, referencia_texto, dispositivo_id } = req.body;

      // Validación básica
      if (!tipo || !lat || !lng) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: tipo, lat, lng' });
      }
      const tiposValidos = ['violencia', 'robo', 'accidente', 'auxilio'];
      if (!tiposValidos.includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de incidente inválido' });
      }

      // RN-04: Anti-duplicación — mismo dispositivo en < 60 segundos
      if (dispositivo_id) {
        const duplicado = db.prepare(`
          SELECT id FROM incidentes
          WHERE dispositivo_id = ?
            AND estado NOT IN ('atendido','cancelado')
            AND created_at > datetime('now', '-60 seconds')
          LIMIT 1
        `).get(dispositivo_id);

        if (duplicado) {
          const existente = db.prepare(`
            SELECT id, ticket, estado, eta_minutos FROM incidentes WHERE id = ?
          `).get(duplicado.id);
          return res.status(200).json({
            consolidado: true,
            message: 'Reporte ya registrado. Tu solicitud ya fue recibida.',
            incidente: existente
          });
        }
      }

      // Rutas de archivos
      const files = req.files || {};
      const fotoPath  = files.evidencia_foto?.[0]  ? `/uploads/${files.evidencia_foto[0].filename}`  : null;
      const audioPth  = files.evidencia_audio?.[0] ? `/uploads/${files.evidencia_audio[0].filename}` : null;
      const vozPath   = files.referencia_voz?.[0]  ? `/uploads/${files.referencia_voz[0].filename}`  : null;

      const ticket    = generarTicket();
      const prioridad = calcularPrioridad(tipo);  // RN-01

      const stmt = db.prepare(`
        INSERT INTO incidentes
          (ticket, tipo, prioridad, lat, lng, referencia_texto, referencia_voz,
           evidencia_foto, evidencia_audio, estado, dispositivo_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `);

      const result = stmt.run(
        ticket, tipo, prioridad,
        parseFloat(lat), parseFloat(lng),
        referencia_texto || null,
        vozPath, fotoPath, audioPth,
        'recibido',
        dispositivo_id || null
      );

      registrarHistorial(db, result.lastInsertRowid, null, 'recibido', null, 'Reporte recibido del ciudadano');

      const incidente = db.prepare('SELECT * FROM incidentes WHERE id = ?').get(result.lastInsertRowid);

      res.status(201).json({ success: true, incidente });
    } catch (err) {
      console.error('Error al crear incidente:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

/**
 * GET /api/incidentes
 * Lista incidentes ordenados por criticidad (RF-06, RN-01)
 */
app.get('/api/incidentes', (req, res) => {
  try {
    const db = getDb();
    const { estado, limit = 50 } = req.query;

    let query = `
      SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre,
             u.telefono as unidad_telefono, u.lat as unidad_lat, u.lng as unidad_lng
      FROM incidentes i
      LEFT JOIN unidades u ON i.unidad_id = u.id
    `;
    const params = [];

    if (estado) {
      query += ' WHERE i.estado = ?';
      params.push(estado);
    } else {
      query += ` WHERE i.estado NOT IN ('atendido','cancelado')`;
    }

    // RN-01: ordenar por prioridad (1=Alta primero), luego por fecha
    query += ' ORDER BY i.prioridad ASC, i.created_at ASC LIMIT ?';
    params.push(parseInt(limit));

    const incidentes = db.prepare(query).all(...params);
    res.json({ incidentes });
  } catch (err) {
    console.error('Error al listar incidentes:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/incidentes/historial
 * Lista incidentes atendidos/cancelados (historial)
 */
app.get('/api/incidentes/historial', (req, res) => {
  try {
    const db = getDb();
    const incidentes = db.prepare(`
      SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre
      FROM incidentes i
      LEFT JOIN unidades u ON i.unidad_id = u.id
      WHERE i.estado IN ('atendido','cancelado')
      ORDER BY i.atendido_at DESC
      LIMIT 100
    `).all();
    res.json({ incidentes });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/incidentes/:ticket
 * Obtiene un incidente por número de ticket (RF-04, RF-05)
 */
app.get('/api/incidentes/:ticket', (req, res) => {
  try {
    const db = getDb();
    const incidente = db.prepare(`
      SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre,
             u.telefono as unidad_telefono, u.lat as unidad_lat, u.lng as unidad_lng
      FROM incidentes i
      LEFT JOIN unidades u ON i.unidad_id = u.id
      WHERE i.ticket = ?
    `).get(req.params.ticket);

    if (!incidente) return res.status(404).json({ error: 'Incidente no encontrado' });

    const historial = db.prepare(`
      SELECT * FROM historial_estados WHERE incidente_id = ? ORDER BY created_at ASC
    `).all(incidente.id);

    res.json({ incidente, historial });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/incidentes/:ticket/asignar
 * Asigna una unidad a un incidente (RF-06, RN-02)
 */
app.patch('/api/incidentes/:ticket/asignar', (req, res) => {
  try {
    const db = getDb();
    const { unidad_id } = req.body;

    const incidente = db.prepare('SELECT * FROM incidentes WHERE ticket = ?').get(req.params.ticket);
    if (!incidente) return res.status(404).json({ error: 'Incidente no encontrado' });
    if (incidente.estado === 'atendido') return res.status(400).json({ error: 'Incidente ya atendido' });

    const unidad = db.prepare('SELECT * FROM unidades WHERE id = ?').get(unidad_id);
    if (!unidad) return res.status(404).json({ error: 'Unidad no encontrada' });

    // Calcula ETA aproximado (velocidad promedio 30 km/h en zona urbana)
    const distKm   = haversine(incidente.lat, incidente.lng, unidad.lat, unidad.lng);
    const etaMin   = Math.max(1, Math.round((distKm / 30) * 60));
    const estadoAnt = incidente.estado;

    db.prepare(`
      UPDATE incidentes
      SET unidad_id=?, eta_minutos=?, estado='asignado', updated_at=CURRENT_TIMESTAMP
      WHERE ticket=?
    `).run(unidad_id, etaMin, req.params.ticket);

    db.prepare(`UPDATE unidades SET estado='en_servicio', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(unidad_id);

    registrarHistorial(db, incidente.id, estadoAnt, 'asignado', unidad_id,
      `Unidad ${unidad.codigo} asignada. ETA: ${etaMin} min`);

    const actualizado = db.prepare(`
      SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre, u.telefono as unidad_telefono
      FROM incidentes i LEFT JOIN unidades u ON i.unidad_id = u.id WHERE i.ticket = ?
    `).get(req.params.ticket);

    res.json({ success: true, incidente: actualizado, eta_minutos: etaMin });
  } catch (err) {
    console.error('Error al asignar unidad:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/incidentes/:ticket/estado
 * Actualiza el estado de un incidente (en_camino, atendido) (RF-04, RF-07)
 */
app.patch('/api/incidentes/:ticket/estado', (req, res) => {
  try {
    const db = getDb();
    const { estado, observaciones } = req.body;
    const estadosValidos = ['en_camino', 'atendido', 'cancelado'];

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const incidente = db.prepare('SELECT * FROM incidentes WHERE ticket = ?').get(req.params.ticket);
    if (!incidente) return res.status(404).json({ error: 'Incidente no encontrado' });

    const estadoAnt = incidente.estado;
    const ahora     = new Date().toISOString();

    let updateQuery = `
      UPDATE incidentes
      SET estado=?, observaciones=?, updated_at=CURRENT_TIMESTAMP
    `;
    const params = [estado, observaciones || null];

    if (estado === 'atendido' || estado === 'cancelado') {
      updateQuery += `, atendido_at='${ahora}'`;
      // Liberar la unidad
      if (incidente.unidad_id) {
        db.prepare(`UPDATE unidades SET estado='disponible', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(incidente.unidad_id);
      }
    }

    updateQuery += ' WHERE ticket=?';
    params.push(req.params.ticket);
    db.prepare(updateQuery).run(...params);

    registrarHistorial(db, incidente.id, estadoAnt, estado, incidente.unidad_id, observaciones);

    const actualizado = db.prepare('SELECT * FROM incidentes WHERE ticket = ?').get(req.params.ticket);
    res.json({ success: true, incidente: actualizado });
  } catch (err) {
    console.error('Error al actualizar estado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  RUTAS DE UNIDADES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/unidades
 * Lista todas las unidades
 */
app.get('/api/unidades', (req, res) => {
  try {
    const db = getDb();
    const unidades = db.prepare('SELECT * FROM unidades ORDER BY estado ASC, codigo ASC').all();
    res.json({ unidades });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/unidades/sugerir?lat=X&lng=Y
 * Sugiere la unidad más cercana (RN-02)
 */
app.get('/api/unidades/sugerir', (req, res) => {
  try {
    const db  = getDb();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Coordenadas inválidas' });
    }

    const unidades = db.prepare(`SELECT * FROM unidades WHERE estado = 'disponible'`).all();

    if (unidades.length === 0) {
      return res.json({ sugerida: null, message: 'No hay unidades disponibles' });
    }

    // Ordenar por distancia Haversine
    const conDistancia = unidades.map(u => ({
      ...u,
      distancia_km: haversine(lat, lng, u.lat, u.lng),
      eta_minutos:  Math.max(1, Math.round((haversine(lat, lng, u.lat, u.lng) / 30) * 60))
    })).sort((a, b) => a.distancia_km - b.distancia_km);

    res.json({
      sugerida: conDistancia[0],
      todas:    conDistancia.slice(0, 5)  // Top 5 más cercanas
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/unidades/:id/ubicacion
 * Actualiza la ubicación GPS de una unidad (Serenazgo en campo)
 */
app.patch('/api/unidades/:id/ubicacion', (req, res) => {
  try {
    const db = getDb();
    const { lat, lng } = req.body;
    db.prepare(`
      UPDATE unidades SET lat=?, lng=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(parseFloat(lat), parseFloat(lng), parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  RUTA DE ESTADÍSTICAS (Dashboard)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/estadisticas', (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total_activos:    db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE estado NOT IN ('atendido','cancelado')`).get().c,
      prioridad_alta:   db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE prioridad=1 AND estado NOT IN ('atendido','cancelado')`).get().c,
      recibidos:        db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE estado='recibido'`).get().c,
      asignados:        db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE estado='asignado'`).get().c,
      en_camino:        db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE estado='en_camino'`).get().c,
      atendidos_hoy:    db.prepare(`SELECT COUNT(*) as c FROM incidentes WHERE estado='atendido' AND date(atendido_at)=date('now')`).get().c,
      unidades_disponibles: db.prepare(`SELECT COUNT(*) as c FROM unidades WHERE estado='disponible'`).get().c,
      unidades_en_servicio: db.prepare(`SELECT COUNT(*) as c FROM unidades WHERE estado='en_servicio'`).get().c,
      por_tipo: db.prepare(`
        SELECT tipo, COUNT(*) as total FROM incidentes
        WHERE date(created_at) = date('now')
        GROUP BY tipo
      `).all(),
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  AUTENTICACIÓN SIMPLE (Operador / Serenazgo)
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', (req, res) => {
  try {
    const db = getDb();
    const { usuario, password } = req.body;
    // En producción usar bcrypt; aquí es comparación directa para propósito académico
    const op = db.prepare(`
      SELECT id, usuario, nombre, rol FROM operadores
      WHERE usuario=? AND password_hash=? AND activo=1
    `).get(usuario, password);

    if (!op) return res.status(401).json({ error: 'Credenciales incorrectas' });
    res.json({ success: true, usuario: op });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  RUTAS SPA — Servir los HTML por rol
// ═════════════════════════════════════════════════════════════════════════════

app.get(['/ciudadano', '/reportar'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ciudadano.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});
app.get('/sereno', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'sereno.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Arranque del servidor ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚔 Sistema Serenazgo Chorrillos`);
  console.log(`   Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Ciudadano  → http://localhost:${PORT}/`);
  console.log(`   Operador   → http://localhost:${PORT}/dashboard`);
  console.log(`   Serenazgo  → http://localhost:${PORT}/sereno\n`);
});

module.exports = app;
