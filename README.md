# 🛡️ Sistema Inclusivo de Atención de Serenazgo
## Municipalidad Distrital de Chorrillos

Plataforma web inclusiva orientada a reducir la demora en el despacho de emergencias y eliminar las barreras de alfabetización digital en sectores vulnerables. Cumplimiento con el estándar internacional **WCAG 2.1 Nivel AA**.

---

## 🚀 Cómo Ejecutar la Aplicación

### Opción Rápida (Recomendada con Python):
1. Haz **doble clic en `INICIAR.bat`**.
2. Se iniciará el servidor y se abrirá automáticamente tu navegador en **http://localhost:3000/**.
*(Para detenerlo, cierra la ventana o haz doble clic en `DETENER.bat`).*

### Opción con Node.js:
```bash
npm install
npm start
```

---

## 🌐 Módulos y Enlaces del Sistema

| Vista / Rol | URL Directa | Descripción |
| :--- | :--- | :--- |
| 🏛️ **Landing Page Oficial** | [http://localhost:3000/](http://localhost:3000/) | Portal institucional responsive (Bootstrap 5, estilo editorial peru.info), Hero con overlay oscuro, beneficiarios y catálogo de servicios. |
| 📱 **Reporte Ciudadano** | [http://localhost:3000/ciudadano.html](http://localhost:3000/ciudadano.html) | Inicio de sesión rápido con DNI y PIN almacenado con hash en SQLite; botón SOS, GPS, notas de voz y reporte en ≤ 3 toques. |
| 🖥️ **Central de Operadores** | [http://localhost:3000/dashboard](http://localhost:3000/dashboard) | Dashboard de escritorio para despacho en 1 clic. Sugiere la unidad más cercana (Haversine + ETA) y prioriza Violencia/Auxilio. *(Login: `operador1` / `serenazgo2024`)* |
| 🚔 **Serenazgo en Campo** | [http://localhost:3000/sereno](http://localhost:3000/sereno) | App móvil para agentes y patrullas con tracking GPS continuo, botón "En camino" y formulario de cierre. *(Login: `sereno1` / `sereno2024`)* |

---

## 📁 Estructura del Código

```
APP_SERENAZGO/
├── INICIAR.bat              ← Lanzador con 1 clic (libera puerto 3000 y abre navegador)
├── DETENER.bat              ← Detiene procesos en el puerto 3000
├── server_python.py         ← Servidor HTTP/API standalone nativo (Python 3.14+)
├── test_e2e.py              ← Script de pruebas de extremo a extremo automatizadas
├── serenazgo.db             ← Base de datos SQLite (auto-inicializada con seed data)
├── package.json             ← Configuración de dependencias Node.js / Express
├── server/
│   ├── database.js          ← Esquema SQLite (incluye ciudadanos) y datos semilla para Node.js
│   └── index.js             ← API REST Express con Multer y Haversine
└── public/
    ├── index.html           ← Landing Page Oficial (Bootstrap 5, WCAG AAA)
    ├── ciudadano.html       ← Módulo móvil de reporte de emergencias
    ├── dashboard.html       ← Dashboard de Operador con mapa y despacho
    ├── sereno.html          ← Interfaz para patrullas de Serenazgo
    ├── img/                 ← Recursos gráficos institucionales
    │   ├── logo-municipalidad.png
    │   ├── hero-bg.jpg
    │   ├── img-ciudadano.jpg
    │   ├── img-operador.jpg
    │   ├── img-sereno.jpg
    │   ├── icon-violencia.png
    │   ├── icon-robo.png
    │   ├── icon-accidente.png
    │   └── icon-auxilio.png
    ├── css/                 ← Hojas de estilo modulares (WCAG 2.1 AA)
    └── js/                  ← Lógica JavaScript Vanilla por rol
```

---

## 🎯 Requerimientos y Reglas Verificadas (100% E2E)

- **RF-01**: GPS satelital automático + ajuste manual interactivo en mapa + grabación de notas de voz de referencia.
- **RF-02**: Catálogo visual con iconos de alta comprensión, reproductor de audio descriptivo (TTS) y selección en 1 toque.
- **RF-03**: Adjunto de evidencia complementaria (fotografía con cámara y grabación de audio).
- **RF-04**: Línea de tiempo secuencial en vivo: *Recibido ➔ Asignado ➔ En camino ➔ Atendido*.
- **RF-05**: Visualización inmediata del código de patrulla, agente asignado y Tiempo Estimado de Llegada (ETA).
- **RF-06**: Panel de gestión para operador con lista ordenada por criticidad y despacho en un solo clic.
- **RF-07**: Registro de cierre de incidente con resultado de intervención y observaciones de campo.
- **RN-01**: Categorías **Violencia** y **Auxilio** ubicadas automáticamente en la cima de la cola (Prioridad Alta).
- **RN-02**: Sugerencia automatizada de la unidad más cercana según coordenadas geodésicas (algoritmo Haversine).
- **RN-03**: El acceso ciudadano requiere DNI y PIN; el PIN se almacena como hash con salt.
- **RN-04**: Anti-duplicidad: consolidación automática de múltiples reportes emitidos en menos de 60 segundos por el mismo dispositivo.
- **Accesibilidad**: Contraste ≥ 4.5:1, áreas táctiles ≥ 48×48px, skip-links y compatibilidad con lectores de pantalla.

El acceso ciudadano ahora permite crear una cuenta rápida con DNI y PIN de 4 dígitos. El PIN se guarda como hash con salt; el DNI se usa para identificar la cuenta. Las estadísticas del Dashboard utilizan los reportes presentes en `localStorage` del mismo navegador. Sus sectores se estiman con las coordenadas GPS y no representan límites oficiales.
