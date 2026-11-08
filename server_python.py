"""
server_python.py
Servidor de desarrollo para Sistema Serenazgo Chorrillos
Reemplaza Node.js/Express usando solo la librería estándar de Python.
Ejecutar: python server_python.py
"""

import http.server
import hashlib
import hmac
import json
import sqlite3
import os
import secrets
import uuid
import datetime
import math
import urllib.parse
import io
import re
import sys
import threading
import time
import webbrowser
from pathlib import Path

BASE_DIR  = Path(__file__).parent
DB_PATH   = BASE_DIR / "serenazgo.db"
UPLOADS   = BASE_DIR / "public" / "uploads"
PUBLIC    = BASE_DIR / "public"
PORT      = 3000

UPLOADS.mkdir(parents=True, exist_ok=True)

# ─── Mime types ───────────────────────────────────────────
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".webm": "audio/webm",
    ".mp3":  "audio/mpeg",
    ".ogg":  "audio/ogg",
    ".wav":  "audio/wav",
    ".ico":  "image/x-icon",
    ".svg":  "image/svg+xml",
}

# ═══════════════════════════════════════════════════════════
#  BASE DE DATOS
# ═══════════════════════════════════════════════════════════

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    cur  = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS unidades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo      TEXT NOT NULL UNIQUE,
            nombre      TEXT NOT NULL,
            telefono    TEXT,
            lat         REAL DEFAULT -12.1611,
            lng         REAL DEFAULT -77.0210,
            estado      TEXT NOT NULL DEFAULT 'disponible',
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS incidentes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket           TEXT NOT NULL UNIQUE,
            tipo             TEXT NOT NULL,
            prioridad        INTEGER NOT NULL DEFAULT 2,
            lat              REAL NOT NULL,
            lng              REAL NOT NULL,
            referencia_texto TEXT,
            referencia_voz   TEXT,
            evidencia_foto   TEXT,
            evidencia_audio  TEXT,
            estado           TEXT NOT NULL DEFAULT 'recibido',
            unidad_id        INTEGER REFERENCES unidades(id),
            eta_minutos      INTEGER,
            dispositivo_id   TEXT,
            observaciones    TEXT,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            atendido_at      DATETIME
        );

        CREATE TABLE IF NOT EXISTS historial_estados (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            incidente_id    INTEGER NOT NULL REFERENCES incidentes(id),
            estado_anterior TEXT,
            estado_nuevo    TEXT NOT NULL,
            unidad_id       INTEGER REFERENCES unidades(id),
            descripcion     TEXT,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS operadores (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario       TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            nombre        TEXT NOT NULL,
            rol           TEXT NOT NULL DEFAULT 'operador',
            activo        INTEGER NOT NULL DEFAULT 1,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ciudadanos (
            dni         TEXT PRIMARY KEY,
            pin         TEXT NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_incidentes_estado     ON incidentes(estado);
        CREATE INDEX IF NOT EXISTS idx_incidentes_prioridad  ON incidentes(prioridad, created_at);
        CREATE INDEX IF NOT EXISTS idx_incidentes_dispositivo ON incidentes(dispositivo_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_unidades_estado       ON unidades(estado);
    """)
    conn.commit()

    # Seed si está vacío
    count = cur.execute("SELECT COUNT(*) FROM unidades").fetchone()[0]
    if count == 0:
        seed_data(conn)
    conn.close()

def seed_data(conn):
    unidades = [
        ('SR-01','Javier Quispe Mamani',   '989-001-001',-12.1611,-77.0210,'disponible'),
        ('SR-02','Rosa Flores Condori',     '989-001-002',-12.1700,-77.0150,'disponible'),
        ('SR-03','Carlos Mena Palomino',    '989-001-003',-12.1550,-77.0300,'disponible'),
        ('SR-04','Ana Ccopa Huanca',        '989-001-004',-12.1800,-77.0100,'en_servicio'),
        ('SR-05','Luis Tapia Villanueva',   '989-001-005',-12.1480,-77.0180,'disponible'),
        ('SR-06','María Ramos Torres',      '989-001-006',-12.1620,-77.0350,'disponible'),
        ('SR-07','Pedro Sánchez León',      '989-001-007',-12.1750,-77.0280,'fuera_servicio'),
        ('SR-08','Sofía García Reyes',      '989-001-008',-12.1500,-77.0400,'disponible'),
    ]
    conn.executemany(
        "INSERT INTO unidades (codigo,nombre,telefono,lat,lng,estado) VALUES (?,?,?,?,?,?)",
        unidades
    )
    conn.executemany(
        "INSERT INTO operadores (usuario,password_hash,nombre,rol) VALUES (?,?,?,?)",
        [('operador1','serenazgo2024','Central Chorrillos','operador'),
         ('sereno1',  'sereno2024',   'Agente Campo 1',    'serenazgo')]
    )
    año = datetime.datetime.now().year
    incidentes_demo = [
        (f'INC-{año}-00001','violencia',1,-12.1611,-77.0210,'Frente al parque central','recibido','demo-dev-001'),
        (f'INC-{año}-00002','robo',     2,-12.1700,-77.0160,'Esquina con ferretería',  'asignado','demo-dev-002'),
        (f'INC-{año}-00003','accidente',2,-12.1550,-77.0310,'Av. Huaylas cdra. 5',     'en_camino','demo-dev-003'),
        (f'INC-{año}-00004','auxilio',  1,-12.1480,-77.0190,'Cerca al mercado',        'recibido','demo-dev-004'),
    ]
    conn.executemany(
        "INSERT INTO incidentes (ticket,tipo,prioridad,lat,lng,referencia_texto,estado,dispositivo_id) VALUES (?,?,?,?,?,?,?,?)",
        incidentes_demo
    )
    conn.execute(f"UPDATE incidentes SET unidad_id=1,eta_minutos=4 WHERE ticket='INC-{año}-00002'")
    conn.execute(f"UPDATE incidentes SET unidad_id=3,eta_minutos=2 WHERE ticket='INC-{año}-00003'")
    conn.commit()

# ═══════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════

def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def generar_ticket(conn):
    año  = datetime.datetime.now().year
    cnt  = conn.execute("SELECT COUNT(*) FROM incidentes").fetchone()[0]
    return f"INC-{año}-{str(cnt+1).zfill(5)}"

def calcular_prioridad(tipo):
    return 1 if tipo in ('violencia', 'auxilio') else 2

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

def now_iso():
    return datetime.datetime.utcnow().isoformat()

def validar_credenciales_ciudadano(dni, pin):
    return (
        isinstance(dni, str) and re.fullmatch(r"\d{8}", dni) is not None
        and isinstance(pin, str) and re.fullmatch(r"\d{4}", pin) is not None
    )

def hash_pin(pin):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"{salt.hex()}:{digest.hex()}"

def verificar_pin(pin, almacenado):
    try:
        salt_hex, digest_hex = almacenado.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        esperado = bytes.fromhex(digest_hex)
        if len(salt) != 16 or len(esperado) != 64:
            return False
        calculado = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
        return hmac.compare_digest(calculado, esperado)
    except (AttributeError, ValueError):
        return False

# ═══════════════════════════════════════════════════════════
#  HANDLER HTTP
# ═══════════════════════════════════════════════════════════

class SerenazgoHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")

    # ── Helpers de respuesta ──────────────────────────────

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def parse_multipart(self):
        """Parsea multipart/form-data de forma manual simplificada."""
        ct = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ct:
            # Intentar como form-urlencoded
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length) if length else b""
            params = urllib.parse.parse_qs(raw.decode("utf-8", errors="ignore"))
            return {k: v[0] for k, v in params.items()}, {}

        # Extraer boundary
        m = re.search(r'boundary=([^\s;]+)', ct)
        if not m:
            return {}, {}
        boundary = ("--" + m.group(1)).encode()

        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)

        fields = {}
        files  = {}

        parts = body.split(boundary)
        for part in parts[1:]:
            if part in (b"--\r\n", b"--"):
                continue
            # Separar headers de contenido
            if b"\r\n\r\n" not in part:
                continue
            headers_raw, content = part.split(b"\r\n\r\n", 1)
            # Quitar CRLF final
            if content.endswith(b"\r\n"):
                content = content[:-2]

            headers_str = headers_raw.decode("utf-8", errors="ignore")
            # Nombre del campo
            nm = re.search(r'name="([^"]+)"', headers_str)
            fn = re.search(r'filename="([^"]*)"', headers_str)
            if not nm:
                continue
            name = nm.group(1)

            if fn:
                fname = fn.group(1)
                if fname:
                    ext  = Path(fname).suffix or ".bin"
                    dest = UPLOADS / (str(uuid.uuid4()) + ext)
                    dest.write_bytes(content)
                    files[name] = f"/uploads/{dest.name}"
            else:
                fields[name] = content.decode("utf-8", errors="ignore")

        return fields, files

    # ── OPTIONS (CORS preflight) ──────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET ───────────────────────────────────────────────

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path.rstrip("/") or "/"
        query  = urllib.parse.parse_qs(parsed.query)

        # ── API ──
        if path.startswith("/api/"):
            self.handle_api_get(path, query)
            return

        # ── SPA routes ──
        if path in ("/ciudadano", "/reportar"):
            self.serve_file(PUBLIC / "ciudadano.html")
            return
        if path == "/dashboard":
            self.serve_file(PUBLIC / "dashboard.html")
            return
        if path == "/sereno":
            self.serve_file(PUBLIC / "sereno.html")
            return
        if path in ("/", ""):
            self.serve_file(PUBLIC / "index.html")
            return

        # ── Archivos estáticos ──
        rel  = path.lstrip("/")
        file = PUBLIC / rel
        if file.exists() and file.is_file():
            self.serve_file(file)
        else:
            self.send_error(404, "Archivo no encontrado")

    def serve_file(self, path: Path):
        if not path.exists():
            self.send_error(404, "No encontrado")
            return
        ext  = path.suffix.lower()
        mime = MIME.get(ext, "application/octet-stream")
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def handle_api_get(self, path, query):
        conn = get_db()
        try:
            # GET /api/incidentes/historial
            if path == "/api/incidentes/historial":
                rows = conn.execute("""
                    SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre
                    FROM incidentes i LEFT JOIN unidades u ON i.unidad_id=u.id
                    WHERE i.estado IN ('atendido','cancelado')
                    ORDER BY i.atendido_at DESC LIMIT 100
                """).fetchall()
                self.send_json({"incidentes": rows_to_list(rows)})
                return

            # GET /api/incidentes/:ticket
            m = re.match(r"^/api/incidentes/(.+)$", path)
            if m:
                ticket = urllib.parse.unquote(m.group(1))
                row = conn.execute("""
                    SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre,
                           u.telefono as unidad_telefono, u.lat as unidad_lat, u.lng as unidad_lng
                    FROM incidentes i LEFT JOIN unidades u ON i.unidad_id=u.id
                    WHERE i.ticket=?
                """, (ticket.upper(),)).fetchone()
                if not row:
                    self.send_error_json("Incidente no encontrado", 404)
                    return
                inc = row_to_dict(row)
                hist = rows_to_list(conn.execute(
                    "SELECT * FROM historial_estados WHERE incidente_id=? ORDER BY created_at ASC",
                    (inc["id"],)
                ).fetchall())
                self.send_json({"incidente": inc, "historial": hist})
                return

            # GET /api/incidentes
            if path == "/api/incidentes":
                estado = query.get("estado", [None])[0]
                limit  = int(query.get("limit", [50])[0])
                if estado:
                    rows = conn.execute("""
                        SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre,
                               u.telefono as unidad_telefono, u.lat as unidad_lat, u.lng as unidad_lng
                        FROM incidentes i LEFT JOIN unidades u ON i.unidad_id=u.id
                        WHERE i.estado=? ORDER BY i.prioridad ASC, i.created_at ASC LIMIT ?
                    """, (estado, limit)).fetchall()
                else:
                    rows = conn.execute("""
                        SELECT i.*, u.codigo as unidad_codigo, u.nombre as unidad_nombre,
                               u.telefono as unidad_telefono, u.lat as unidad_lat, u.lng as unidad_lng
                        FROM incidentes i LEFT JOIN unidades u ON i.unidad_id=u.id
                        WHERE i.estado NOT IN ('atendido','cancelado')
                        ORDER BY i.prioridad ASC, i.created_at ASC LIMIT ?
                    """, (limit,)).fetchall()
                self.send_json({"incidentes": rows_to_list(rows)})
                return

            # GET /api/unidades/sugerir?lat=X&lng=Y
            if path == "/api/unidades/sugerir":
                lat = float(query.get("lat", [0])[0])
                lng = float(query.get("lng", [0])[0])
                rows = rows_to_list(conn.execute(
                    "SELECT * FROM unidades WHERE estado='disponible'"
                ).fetchall())
                if not rows:
                    self.send_json({"sugerida": None, "todas": [], "message": "Sin unidades disponibles"})
                    return
                for u in rows:
                    dist = haversine(lat, lng, u["lat"], u["lng"])
                    u["distancia_km"]  = round(dist, 3)
                    u["eta_minutos"]   = max(1, round((dist / 30) * 60))
                rows.sort(key=lambda x: x["distancia_km"])
                self.send_json({"sugerida": rows[0], "todas": rows[:5]})
                return

            # GET /api/unidades
            if path == "/api/unidades":
                rows = rows_to_list(conn.execute(
                    "SELECT * FROM unidades ORDER BY estado ASC, codigo ASC"
                ).fetchall())
                self.send_json({"unidades": rows})
                return

            # GET /api/estadisticas
            if path == "/api/estadisticas":
                def cnt(sql, *p):
                    return conn.execute(sql, p).fetchone()[0]
                stats = {
                    "total_activos":          cnt("SELECT COUNT(*) FROM incidentes WHERE estado NOT IN ('atendido','cancelado')"),
                    "prioridad_alta":         cnt("SELECT COUNT(*) FROM incidentes WHERE prioridad=1 AND estado NOT IN ('atendido','cancelado')"),
                    "recibidos":              cnt("SELECT COUNT(*) FROM incidentes WHERE estado='recibido'"),
                    "asignados":              cnt("SELECT COUNT(*) FROM incidentes WHERE estado='asignado'"),
                    "en_camino":              cnt("SELECT COUNT(*) FROM incidentes WHERE estado='en_camino'"),
                    "atendidos_hoy":          cnt("SELECT COUNT(*) FROM incidentes WHERE estado='atendido' AND date(atendido_at)=date('now')"),
                    "unidades_disponibles":   cnt("SELECT COUNT(*) FROM unidades WHERE estado='disponible'"),
                    "unidades_en_servicio":   cnt("SELECT COUNT(*) FROM unidades WHERE estado='en_servicio'"),
                    "por_tipo": rows_to_list(conn.execute(
                        "SELECT tipo, COUNT(*) as total FROM incidentes WHERE date(created_at)=date('now') GROUP BY tipo"
                    ).fetchall()),
                }
                self.send_json(stats)
                return

            self.send_error_json("Ruta no encontrada", 404)
        except Exception as e:
            print(f"[ERROR GET] {e}")
            self.send_error_json(str(e), 500)
        finally:
            conn.close()

    # ── POST ──────────────────────────────────────────────

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        # POST /api/ciudadanos/registro
        if path == "/api/ciudadanos/registro":
            body = self.read_json_body()
            dni = body.get("dni")
            pin = body.get("pin")
            if not validar_credenciales_ciudadano(dni, pin):
                self.send_error_json("El DNI debe tener 8 dígitos y el PIN, 4.", 400)
                return

            conn = get_db()
            try:
                conn.execute(
                    "INSERT INTO ciudadanos (dni,pin) VALUES (?,?)",
                    (dni, hash_pin(pin))
                )
                conn.commit()
                self.send_json({"success": True, "dni": dni}, 201)
            except sqlite3.IntegrityError:
                self.send_error_json("Ya existe una cuenta registrada con ese DNI.", 409)
            except Exception as e:
                print(f"[ERROR REGISTRO CIUDADANO] {e}")
                self.send_error_json("No se pudo crear la cuenta.", 500)
            finally:
                conn.close()
            return

        # POST /api/ciudadanos/login
        if path == "/api/ciudadanos/login":
            body = self.read_json_body()
            dni = body.get("dni")
            pin = body.get("pin")
            if not validar_credenciales_ciudadano(dni, pin):
                self.send_error_json("El DNI debe tener 8 dígitos y el PIN, 4.", 400)
                return

            conn = get_db()
            try:
                ciudadano = conn.execute(
                    "SELECT dni,pin FROM ciudadanos WHERE dni=?", (dni,)
                ).fetchone()
                if not ciudadano or not verificar_pin(pin, ciudadano["pin"]):
                    self.send_error_json("DNI o PIN incorrectos.", 401)
                    return
                self.send_json({"success": True, "dni": ciudadano["dni"]})
            except Exception as e:
                print(f"[ERROR LOGIN CIUDADANO] {e}")
                self.send_error_json("No se pudo validar el acceso.", 500)
            finally:
                conn.close()
            return

        # POST /api/auth/login
        if path == "/api/auth/login":
            body = self.read_json_body()
            conn = get_db()
            try:
                row = conn.execute(
                    "SELECT id,usuario,nombre,rol FROM operadores WHERE usuario=? AND password_hash=? AND activo=1",
                    (body.get("usuario",""), body.get("password",""))
                ).fetchone()
                if not row:
                    self.send_error_json("Credenciales incorrectas", 401)
                    return
                self.send_json({"success": True, "usuario": row_to_dict(row)})
            finally:
                conn.close()
            return

        # POST /api/incidentes
        if path == "/api/incidentes":
            fields, files = self.parse_multipart()
            tipo   = fields.get("tipo", "")
            lat    = fields.get("lat",  "")
            lng    = fields.get("lng",  "")
            dev_id = fields.get("dispositivo_id", "")
            ref_tx = fields.get("referencia_texto", "")

            if not tipo or not lat or not lng:
                self.send_error_json("Faltan campos: tipo, lat, lng")
                return
            if tipo not in ("violencia","robo","accidente","auxilio"):
                self.send_error_json("Tipo inválido")
                return

            conn = get_db()
            try:
                # Anti-duplicación RN-04
                if dev_id:
                    dup = conn.execute("""
                        SELECT id,ticket,estado,eta_minutos FROM incidentes
                        WHERE dispositivo_id=? AND estado NOT IN ('atendido','cancelado')
                          AND created_at > datetime('now','-60 seconds')
                        LIMIT 1
                    """, (dev_id,)).fetchone()
                    if dup:
                        self.send_json({"consolidado": True,
                                        "message": "Reporte ya registrado.",
                                        "incidente": row_to_dict(dup)})
                        return

                ticket   = generar_ticket(conn)
                prioridad = calcular_prioridad(tipo)
                foto_path  = files.get("evidencia_foto")
                audio_path = files.get("evidencia_audio")
                voz_path   = files.get("referencia_voz")

                cur = conn.execute("""
                    INSERT INTO incidentes
                      (ticket,tipo,prioridad,lat,lng,referencia_texto,referencia_voz,
                       evidencia_foto,evidencia_audio,estado,dispositivo_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, (ticket, tipo, prioridad, float(lat), float(lng),
                      ref_tx or None, voz_path, foto_path, audio_path,
                      "recibido", dev_id or None))
                inc_id = cur.lastrowid
                conn.execute("""
                    INSERT INTO historial_estados (incidente_id,estado_anterior,estado_nuevo,descripcion)
                    VALUES (?,?,?,?)
                """, (inc_id, None, "recibido", "Reporte recibido del ciudadano"))
                conn.commit()

                inc = row_to_dict(conn.execute("SELECT * FROM incidentes WHERE id=?", (inc_id,)).fetchone())
                self.send_json({"success": True, "incidente": inc}, 201)
            finally:
                conn.close()
            return

        self.send_error_json("Ruta no encontrada", 404)

    # ── PATCH ─────────────────────────────────────────────

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path
        body   = self.read_json_body()
        conn   = get_db()

        try:
            # PATCH /api/incidentes/:ticket/asignar
            m = re.match(r"^/api/incidentes/(.+)/asignar$", path)
            if m:
                ticket    = urllib.parse.unquote(m.group(1)).upper()
                unidad_id = int(body.get("unidad_id", 0))

                inc = row_to_dict(conn.execute("SELECT * FROM incidentes WHERE ticket=?", (ticket,)).fetchone())
                if not inc:
                    self.send_error_json("Incidente no encontrado", 404); return
                if inc["estado"] == "atendido":
                    self.send_error_json("Ya atendido"); return

                unidad = row_to_dict(conn.execute("SELECT * FROM unidades WHERE id=?", (unidad_id,)).fetchone())
                if not unidad:
                    self.send_error_json("Unidad no encontrada", 404); return

                dist_km  = haversine(inc["lat"], inc["lng"], unidad["lat"], unidad["lng"])
                eta_min  = max(1, round((dist_km / 30) * 60))

                conn.execute("UPDATE incidentes SET unidad_id=?,eta_minutos=?,estado='asignado',updated_at=CURRENT_TIMESTAMP WHERE ticket=?",
                             (unidad_id, eta_min, ticket))
                conn.execute("UPDATE unidades SET estado='en_servicio',updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             (unidad_id,))
                conn.execute("INSERT INTO historial_estados (incidente_id,estado_anterior,estado_nuevo,unidad_id,descripcion) VALUES (?,?,?,?,?)",
                             (inc["id"], inc["estado"], "asignado", unidad_id,
                              f"Unidad {unidad['codigo']} asignada. ETA: {eta_min} min"))
                conn.commit()

                actualizado = row_to_dict(conn.execute("""
                    SELECT i.*,u.codigo as unidad_codigo,u.nombre as unidad_nombre,u.telefono as unidad_telefono
                    FROM incidentes i LEFT JOIN unidades u ON i.unidad_id=u.id WHERE i.ticket=?
                """, (ticket,)).fetchone())
                self.send_json({"success": True, "incidente": actualizado, "eta_minutos": eta_min})
                return

            # PATCH /api/incidentes/:ticket/estado
            m = re.match(r"^/api/incidentes/(.+)/estado$", path)
            if m:
                ticket      = urllib.parse.unquote(m.group(1)).upper()
                estado      = body.get("estado","")
                observaciones = body.get("observaciones","")

                if estado not in ("en_camino","atendido","cancelado"):
                    self.send_error_json("Estado inválido"); return

                inc = row_to_dict(conn.execute("SELECT * FROM incidentes WHERE ticket=?", (ticket,)).fetchone())
                if not inc:
                    self.send_error_json("Incidente no encontrado", 404); return

                if estado in ("atendido","cancelado"):
                    conn.execute("UPDATE incidentes SET estado=?,observaciones=?,atendido_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE ticket=?",
                                 (estado, observaciones or None, ticket))
                    if inc["unidad_id"]:
                        conn.execute("UPDATE unidades SET estado='disponible',updated_at=CURRENT_TIMESTAMP WHERE id=?",
                                     (inc["unidad_id"],))
                else:
                    conn.execute("UPDATE incidentes SET estado=?,observaciones=?,updated_at=CURRENT_TIMESTAMP WHERE ticket=?",
                                 (estado, observaciones or None, ticket))

                conn.execute("INSERT INTO historial_estados (incidente_id,estado_anterior,estado_nuevo,unidad_id,descripcion) VALUES (?,?,?,?,?)",
                             (inc["id"], inc["estado"], estado, inc["unidad_id"], observaciones))
                conn.commit()

                actualizado = row_to_dict(conn.execute("SELECT * FROM incidentes WHERE ticket=?", (ticket,)).fetchone())
                self.send_json({"success": True, "incidente": actualizado})
                return

            # PATCH /api/unidades/:id/ubicacion
            m = re.match(r"^/api/unidades/(\d+)/ubicacion$", path)
            if m:
                uid = int(m.group(1))
                lat = float(body.get("lat", 0))
                lng = float(body.get("lng", 0))
                conn.execute("UPDATE unidades SET lat=?,lng=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             (lat, lng, uid))
                conn.commit()
                self.send_json({"success": True})
                return

            self.send_error_json("Ruta no encontrada", 404)
        except Exception as e:
            print(f"[ERROR PATCH] {e}")
            self.send_error_json(str(e), 500)
        finally:
            conn.close()


# ═══════════════════════════════════════════════════════════
#  ARRANQUE
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    init_db()

    class ReusableHTTPServer(http.server.ThreadingHTTPServer):
        allow_reuse_address = False
        daemon_threads = True

    try:
        server = ReusableHTTPServer(("0.0.0.0", PORT), SerenazgoHandler)
    except OSError as e:
        print(f"\n[ALERTA] Puerto {PORT} en uso: {e}")
        print("Intentando continuar si el servidor ya está activo...")
        sys.exit(0)

    print("\n" + "═"*58)
    print("  🚨 Sistema Inclusivo de Serenazgo - Chorrillos")
    print("═"*58)
    print(f"  🌐 Ciudadano (Móvil)   → http://localhost:{PORT}/")
    print(f"  🖥️  Operador Central    → http://localhost:{PORT}/dashboard")
    print(f"  🚔 Serenazgo en Campo  → http://localhost:{PORT}/sereno")
    print("═"*58)
    print("  Servidor en ejecución. Presiona Ctrl+C para detener.\n")

    def abrir_navegador():
        time.sleep(1.0)
        try:
            webbrowser.open(f"http://localhost:{PORT}/")
        except Exception:
            pass

    threading.Thread(target=abrir_navegador, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor detenido con éxito.")
        server.server_close()
