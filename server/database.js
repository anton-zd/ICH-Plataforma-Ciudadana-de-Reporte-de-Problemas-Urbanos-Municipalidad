// server/database.js
// Esquema de Base de Datos SQLite para el Sistema de Serenazgo
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'serenazgo.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    -- =====================================================
    -- TABLA: unidades
    -- Almacena las unidades/agentes de Serenazgo
    -- =====================================================
    CREATE TABLE IF NOT EXISTS unidades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo      TEXT NOT NULL UNIQUE,         -- Ej: "SR-07"
      nombre      TEXT NOT NULL,                -- Nombre del agente
      telefono    TEXT,
      lat         REAL DEFAULT -12.1611,        -- Latitud actual
      lng         REAL DEFAULT -77.0210,        -- Longitud actual
      estado      TEXT NOT NULL DEFAULT 'disponible'
                  CHECK(estado IN ('disponible','en_servicio','fuera_servicio')),
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================================================
    -- TABLA: incidentes
    -- Registra cada emergencia reportada por ciudadanos
    -- =====================================================
    CREATE TABLE IF NOT EXISTS incidentes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket          TEXT NOT NULL UNIQUE,     -- UUID legible (ej: "INC-2024-00042")
      tipo            TEXT NOT NULL
                      CHECK(tipo IN ('violencia','robo','accidente','auxilio')),
      prioridad       INTEGER NOT NULL DEFAULT 2
                      CHECK(prioridad IN (1,2)),  -- 1=Alta, 2=Normal
      lat             REAL NOT NULL,
      lng             REAL NOT NULL,
      referencia_texto TEXT,                    -- Referencia adicional escrita
      referencia_voz  TEXT,                     -- Ruta del archivo de audio de referencia
      evidencia_foto  TEXT,                     -- Ruta de la fotografía adjunta
      evidencia_audio TEXT,                     -- Ruta del audio de evidencia
      estado          TEXT NOT NULL DEFAULT 'recibido'
                      CHECK(estado IN ('recibido','asignado','en_camino','atendido','cancelado')),
      unidad_id       INTEGER REFERENCES unidades(id),
      eta_minutos     INTEGER,                  -- Tiempo Estimado de Llegada en minutos
      dispositivo_id  TEXT,                     -- Fingerprint del dispositivo (anonimato)
      observaciones   TEXT,                     -- Notas al cerrar el incidente
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      atendido_at     DATETIME                  -- Fecha/hora de cierre
    );

    -- =====================================================
    -- TABLA: historial_estados
    -- Trazabilidad de cada cambio de estado por incidente
    -- =====================================================
    CREATE TABLE IF NOT EXISTS historial_estados (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      incidente_id INTEGER NOT NULL REFERENCES incidentes(id),
      estado_anterior TEXT,
      estado_nuevo    TEXT NOT NULL,
      unidad_id       INTEGER REFERENCES unidades(id),
      descripcion     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================================================
    -- TABLA: operadores
    -- Personal de la Central de Serenazgo
    -- =====================================================
    CREATE TABLE IF NOT EXISTS operadores (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario     TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nombre      TEXT NOT NULL,
      rol         TEXT NOT NULL DEFAULT 'operador'
                  CHECK(rol IN ('operador','supervisor','serenazgo')),
      activo      INTEGER NOT NULL DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ciudadanos (
      dni         TEXT PRIMARY KEY,
      pin         TEXT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Índices para consultas frecuentes
    CREATE INDEX IF NOT EXISTS idx_incidentes_estado    ON incidentes(estado);
    CREATE INDEX IF NOT EXISTS idx_incidentes_prioridad ON incidentes(prioridad, created_at);
    CREATE INDEX IF NOT EXISTS idx_incidentes_dispositivo ON incidentes(dispositivo_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_unidades_estado      ON unidades(estado);
  `);

  // Seed de datos iniciales si las tablas están vacías
  const countUnidades = db.prepare('SELECT COUNT(*) as c FROM unidades').get();
  if (countUnidades.c === 0) {
    seedData();
  }
}

function seedData() {
  // Unidades de Serenazgo con posiciones en Chorrillos
  const insertUnidad = db.prepare(`
    INSERT INTO unidades (codigo, nombre, telefono, lat, lng, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const unidades = [
    ['SR-01', 'Javier Quispe Mamani',    '989-001-001', -12.1611, -77.0210, 'disponible'],
    ['SR-02', 'Rosa Flores Condori',      '989-001-002', -12.1700, -77.0150, 'disponible'],
    ['SR-03', 'Carlos Mena Palomino',     '989-001-003', -12.1550, -77.0300, 'disponible'],
    ['SR-04', 'Ana Ccopa Huanca',         '989-001-004', -12.1800, -77.0100, 'en_servicio'],
    ['SR-05', 'Luis Tapia Villanueva',    '989-001-005', -12.1480, -77.0180, 'disponible'],
    ['SR-06', 'María Ramos Torres',       '989-001-006', -12.1620, -77.0350, 'disponible'],
    ['SR-07', 'Pedro Sánchez León',       '989-001-007', -12.1750, -77.0280, 'fuera_servicio'],
    ['SR-08', 'Sofía García Reyes',       '989-001-008', -12.1500, -77.0400, 'disponible'],
  ];

  const insertarUnidades = db.transaction(() => {
    unidades.forEach(u => insertUnidad.run(...u));
  });
  insertarUnidades();

  // Operador por defecto
  const insertOp = db.prepare(`
    INSERT INTO operadores (usuario, password_hash, nombre, rol)
    VALUES (?, ?, ?, ?)
  `);
  // Contraseña: "serenazgo2024" - en producción usar bcrypt
  insertOp.run('operador1', 'serenazgo2024', 'Central Chorrillos', 'operador');
  insertOp.run('sereno1',   'sereno2024',    'Agente Campo 1',      'serenazgo');

  // Incidentes de ejemplo
  const insertInc = db.prepare(`
    INSERT INTO incidentes (ticket, tipo, prioridad, lat, lng, referencia_texto, estado, dispositivo_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const incidentesEjemplo = [
    ['INC-2024-00001', 'violencia', 1, -12.1611, -77.0210, 'Frente al parque central', 'recibido',  'demo-dev-001'],
    ['INC-2024-00002', 'robo',      2, -12.1700, -77.0160, 'Esquina con ferretería',   'asignado',  'demo-dev-002'],
    ['INC-2024-00003', 'accidente', 2, -12.1550, -77.0310, 'Av. Huaylas cdra. 5',      'en_camino', 'demo-dev-003'],
    ['INC-2024-00004', 'auxilio',   1, -12.1480, -77.0190, 'Cerca al mercado',         'recibido',  'demo-dev-004'],
  ];

  const insertarIncidentes = db.transaction(() => {
    incidentesEjemplo.forEach(i => insertInc.run(...i));
  });
  insertarIncidentes();

  // Asignar unidades a los incidentes de ejemplo
  db.prepare(`UPDATE incidentes SET unidad_id=1, eta_minutos=4 WHERE ticket='INC-2024-00002'`).run();
  db.prepare(`UPDATE incidentes SET unidad_id=3, eta_minutos=2 WHERE ticket='INC-2024-00003'`).run();
}

module.exports = { getDb };
