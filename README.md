# Sistema Inclusivo de Atención de Serenazgo

Aplicación web de atención de emergencias de la Municipalidad de Chorrillos. La persistencia y autenticación se realizan en Supabase; la aplicación web es estática y no requiere Node.js, Express ni SQLite.

## Configuración de Supabase

1. Crea un proyecto Supabase.
2. Ejecuta [`supabase/schema.sql`](./supabase/schema.sql) completo en el SQL Editor del proyecto. Este script crea las tablas y políticas RLS; no almacena PIN en texto plano.
3. La Project URL y la clave **publishable** se inicializan en los tres módulos JavaScript de `public/js/`. Esa clave es pública por diseño; nunca pegues la `service_role` key en archivos `public/`.
4. Instala y autentica Supabase CLI, vincula el proyecto y configura el secreto para derivar contraseñas:

   ```sh
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase secrets set CITIZEN_PIN_PEPPER="un-secreto-aleatorio-largo"
   supabase functions deploy ciudadanos-auth --no-verify-jwt
   ```

   Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` al entorno Edge. La clave `service_role` nunca debe copiarse a archivos del sitio. La función limita los intentos fallidos por DNI y dirección IP.
   La función usa la lista CORS mantenida por `supabase-js`; vuelve a desplegarla con el comando anterior después de cualquier cambio de CORS. Si la llamada falla, confirma que vinculaste el proyecto correcto (`supabase projects list` / `supabase link`) y revisa los logs de `ciudadanos-auth` en Supabase Dashboard.

5. Crea los usuarios de personal desde Supabase Auth:
   - Usa correos `operador1@personal.serenazgo.invalid` y `sereno1@personal.serenazgo.invalid` (o los nombres de usuario que prefieras).
   - Asigna contraseñas seguras en Auth y ejecuta en el SQL Editor, sustituyendo los correos si cambiaste los usuarios:

     ```sql
     UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
       || '{"role":"operador","nombre":"Central Chorrillos"}'::jsonb
     WHERE email = 'operador1@personal.serenazgo.invalid';

     UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
       || '{"role":"sereno","unit_code":"SR-01","nombre":"Patrulla SR-01"}'::jsonb
     WHERE email = 'sereno1@personal.serenazgo.invalid';
     ```

   - Los roles deben configurarse como **app metadata** de administración, nunca como user metadata modificable por el cliente. Vuelve a iniciar sesión tras cambiar los metadatos para emitir un JWT actualizado.

## Ejecutar localmente

Sirve la carpeta `public/` con cualquier servidor estático; por ejemplo, desde la raíz del proyecto:

```sh
python -m http.server 3000 --directory public
```

Abre:

- Ciudadano: <http://localhost:3000/ciudadano.html>
- Central de operaciones: <http://localhost:3000/dashboard.html>
- Serenazgo en campo: <http://localhost:3000/sereno.html>

La ubicación GPS requiere un origen seguro (localhost o HTTPS). También puedes desplegar `public/` en un hosting estático.

## Persistencia y permisos

- Los reportes, estados, asignaciones y evidencias se guardan en la tabla `incidentes`.
- Un ciudadano puede mantener solo una solicitud activa; las funciones `agregar_anotacion_ciudadano` y `cancelar_incidente_ciudadano` autorizan anotaciones y cancelación del titular. Después de actualizar `supabase/schema.sql`, ejecútalo de nuevo en el SQL Editor; si el índice de solicitud activa falla, revisa y resuelve primero si existe más de un incidente activo para el mismo DNI.
- El DNI se valida mediante la Edge Function `ciudadanos-auth`. El PIN ciudadano es de 4 dígitos, no se guarda en la tabla `ciudadanos` y se deriva a una contraseña de Supabase Auth con un secreto del servidor. Las cuentas internas de operador/sereno usan el dominio separado `@personal.serenazgo.invalid`; las cuentas ciudadanas se crean en `@ciudadanos.serenazgo.invalid`.
- Las políticas RLS limitan la lectura de reportes a su titular, al operador autenticado o a la unidad asignada. La clave `anon` del navegador es pública por diseño; nunca debe sustituirse por la `service_role`.
- El dashboard se suscribe a Supabase Realtime para refrescar incidentes y KPIs al instante; conserva una consulta periódica como respaldo. El seguimiento del ciudadano consulta por número de ticket.
- Las fotos y audios se guardan como Data URL en columnas de texto, según el flujo existente. Para producción y archivos grandes, conviene migrarlos a Supabase Storage y guardar en la fila solo sus rutas.
- Los datos que existían en SQLite o en `localStorage` no se importan automáticamente; esta migración afecta los reportes nuevos.

## Módulos

- `public/ciudadano.html`: acceso DNI/PIN, creación de reportes, GPS, adjuntos y seguimiento.
- `public/dashboard.html`: autenticación de operador, cola priorizada, despacho, historial y estadísticas.
- `public/sereno.html`: autenticación de unidad, asignación, estados y cierre con observaciones.
- `supabase/schema.sql`: tablas, permisos RLS y control de intentos del login ciudadano.
- `supabase/functions/ciudadanos-auth/index.ts`: registro y autenticación segura DNI/PIN.
