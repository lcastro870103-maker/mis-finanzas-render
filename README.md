# Mis Finanzas

Aplicación académica sencilla para registrar y consultar ingresos y gastos. Está construida con Node.js, Express, PostgreSQL, Bootstrap 5 y JavaScript, con interfaz en español de México.

## Funciones

- Alta, consulta, edición y eliminación de movimientos.
- Resumen de ingresos, gastos y saldo para el mes seleccionado o todos los movimientos.
- Filtro por mes y descarga CSV en UTF-8.
- Acceso de demostración con contraseña configurable, sesión firmada y protección CSRF.
- Enlaces a Google Sheets y Google Drive.
- Consultas SQL parametrizadas y validación de datos en el servidor.

Los enlaces a Google Sheets y Google Drive abren esos servicios; no hay conexión ni sincronización automática. La contraseña compartida es solo una protección básica de demostración, no un sistema de cuentas. No ingreses información financiera sensible.

## Requisitos

- Node.js 18 o posterior.
- PostgreSQL 12 o posterior.

## Ejecución local

1. Crea una base de datos llamada `mis_finanzas` y ejecuta `schema.sql` si aún no has creado las tablas.
2. Copia `.env.example` a `.env`; reemplaza todos los valores de ejemplo y configura `DATABASE_URL`, `DEMO_PASSWORD` y `SESSION_SECRET`. Mantén `.env` fuera del control de versiones.
3. Genera un secreto de sesión aleatorio de 32 bytes con:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Instala dependencias e inicia la aplicación:

   ```sh
   npm install
   npm start
   ```

5. Abre <http://localhost:3000>.

Para desarrollo con reinicio automático, usa `npm run dev`.

## Despliegue en Render

1. Crea una base de datos PostgreSQL y un servicio **Web Service** para este proyecto.
2. En las variables del Web Service configura:
   - `DATABASE_URL`: URL interna de PostgreSQL si ambos servicios están en la misma región.
   - `PGSSL=true` si la conexión requiere SSL.
   - `DEMO_PASSWORD`: una contraseña larga, única y de demostración.
   - `SESSION_SECRET`: un valor aleatorio de al menos 32 caracteres (puedes generarlo con el comando anterior).
   - `NODE_ENV=production` para activar las comprobaciones de configuración de producción.
   - `COOKIE_SECURE=true` para que la cookie de sesión solo viaje por HTTPS.
3. Configura el comando de compilación como `npm install` y el comando de inicio como `npm start`. Render proporciona la variable `PORT`.
4. Crea la tabla ejecutando manualmente `schema.sql` si aún no existe. La aplicación no ejecuta migraciones ni inicializa esquemas automáticamente.

La ruta `/healthz` responde para comprobaciones de disponibilidad sin requerir sesión. Las sesiones son cookies firmadas de ocho horas; no contienen la contraseña. Los intentos de inicio de sesión tienen un límite básico por IP. No publiques credenciales en el repositorio y configura las variables sensibles en el panel de Render. La contraseña compartida no sustituye autenticación individual ni hace adecuada esta aplicación para datos financieros sensibles.
