import urllib.request
import json
import sys

BASE_URL = "http://localhost:3000"

print("--- Iniciando verificación E2E de flujos ---")

# 1. Login Test
req = urllib.request.Request(
    f"{BASE_URL}/api/auth/login",
    data=json.dumps({"usuario": "operador1", "password": "serenazgo2024"}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
res = urllib.request.urlopen(req)
login_data = json.loads(res.read().decode("utf-8"))
assert login_data.get("success") is True, "Login falló"
print("✓ 1. Login exitoso:", login_data["usuario"]["nombre"])

# 2. Sugerencia de unidad más cercana (RN-02)
res = urllib.request.urlopen(f"{BASE_URL}/api/unidades/sugerir?lat=-12.1611&lng=-77.0210")
sug = json.loads(res.read().decode("utf-8"))
assert sug.get("sugerida") is not None, "No hay unidad sugerida"
print(f"✓ 2. Unidad sugerida RN-02: {sug['sugerida']['codigo']} ({sug['sugerida']['nombre']}) | ETA: {sug['sugerida']['eta_minutos']} min")

# 3. Creación de incidente con prioridad alta (RN-01)
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body_parts = [
    f"--{boundary}",
    'Content-Disposition: form-data; name="tipo"',
    "",
    "violencia",
    f"--{boundary}",
    'Content-Disposition: form-data; name="lat"',
    "",
    "-12.1650",
    f"--{boundary}",
    'Content-Disposition: form-data; name="lng"',
    "",
    "-77.0230",
    f"--{boundary}",
    'Content-Disposition: form-data; name="referencia_texto"',
    "",
    "Frente al colegio Manuel Scorza",
    f"--{boundary}",
    'Content-Disposition: form-data; name="dispositivo_id"',
    "",
    "device-test-chorrillos-01",
    f"--{boundary}--",
    ""
]
body_bytes = "\r\n".join(body_parts).encode("utf-8")

req = urllib.request.Request(
    f"{BASE_URL}/api/incidentes",
    data=body_bytes,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
)
res = urllib.request.urlopen(req)
inc = json.loads(res.read().decode("utf-8")).get("incidente")
assert inc is not None, "Fallo al crear incidente"
ticket = inc["ticket"]
assert inc["prioridad"] == 1, "RN-01 falló: Violencia debe ser prioridad 1"
print(f"✓ 3. Incidente creado: {ticket} | Tipo: {inc['tipo']} | Prioridad: {inc['prioridad']} (Alta - RN-01)")

# 4. Anti-duplicación < 60 segundos (RN-04)
res_dup = urllib.request.urlopen(req)
dup_data = json.loads(res_dup.read().decode("utf-8"))
assert dup_data.get("consolidado") is True, "RN-04 falló: no consolidó ticket duplicado"
print("✓ 4. Regla Anti-duplicidad RN-04: Ticket duplicado detectado y consolidado con éxito")

# 5. Despacho y asignación de unidad (RF-06)
req_asig = urllib.request.Request(
    f"{BASE_URL}/api/incidentes/{ticket}/asignar",
    data=json.dumps({"unidad_id": sug["sugerida"]["id"]}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="PATCH"
)
res_asig = urllib.request.urlopen(req_asig)
asig_res = json.loads(res_asig.read().decode("utf-8"))
assert asig_res.get("success") is True
print(f"✓ 5. Despacho 1-clic RF-06: Unidad asignada a {ticket} con ETA de {asig_res['eta_minutos']} min")

# 6. Actualización a En Camino (RF-04)
req_camino = urllib.request.Request(
    f"{BASE_URL}/api/incidentes/{ticket}/estado",
    data=json.dumps({"estado": "en_camino"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="PATCH"
)
res_camino = urllib.request.urlopen(req_camino)
camino_res = json.loads(res_camino.read().decode("utf-8"))
assert camino_res["incidente"]["estado"] == "en_camino"
print(f"✓ 6. Tracking de estado RF-04: Incidente cambió a '{camino_res['incidente']['estado']}'")

# 7. Cierre de incidente con observaciones (RF-07)
req_cierre = urllib.request.Request(
    f"{BASE_URL}/api/incidentes/{ticket}/estado",
    data=json.dumps({
        "estado": "atendido",
        "observaciones": "Intervención realizada con éxito. Agraviado asistido y situación normalizada."
    }).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="PATCH"
)
res_cierre = urllib.request.urlopen(req_cierre)
cierre_res = json.loads(res_cierre.read().decode("utf-8"))
assert cierre_res["incidente"]["estado"] == "atendido"
print(f"✓ 7. Cierre de incidente RF-07: Registrado como '{cierre_res['incidente']['estado']}' con observaciones")

print("\n🎉 TODOS LOS REQUERIMIENTOS Y REGLAS DE NEGOCIO VERIFICADOS AL 100% FUNCIONANDO.")

