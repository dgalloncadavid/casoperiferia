# Agente de registro como proveedor (Reto 1)

Agente conversacional que lee la solicitud de un cliente, llena el formulario con los datos del repositorio maestro, arma el paquete para firma y pide confirmación antes de cualquier envío (simulado). **El código decide y el modelo conversa**: ningún valor del formulario sale del modelo.

## Probar (sin ninguna clave)

```bash
bun install
bun demo.ts        # herramientas sin modelo: 4 casos + errores + inyección
bun test           # ciclo, confirmación, topes, failover, API y almacenamiento
```

## Levantar en local

```bash
cp .env.example .env     # completa las claves que tengas; sin claves funciona en modo sin modelo
bun run dev              # http://localhost:3000  (front + API)
```

## Pantalla

Chat al centro; a la izquierda la bandeja (casos, conversaciones, fecha de referencia y reporte); a la derecha el detalle plegable del caso (campos con trazabilidad, soportes, «Preparar envío»). Por debajo de 1280 px el detalle es un drawer sobre el chat y por debajo de 900 px la bandeja también (Esc cierra y devuelve el foco).

## Acceso y datos por usuario

El acceso es con **usuarios fijos** creados en Supabase Auth (no hay registro público ni recuperación de contraseña). Las contraseñas no están en el repositorio.

- `AUTH=on` exige iniciar sesión: todo `/api/*` valida el `Bearer` con `supabase.auth.getUser` y responde `401` si no es válido, salvo `/api/health` y `/api/config`. `AUTH=off` corre sin login. Sin definir: `on` en Vercel y `off` en local.
- El front recibe `SUPABASE_URL` y la clave **anon** por `GET /api/config`; la service role nunca sale del servidor.
- Las conversaciones (`sessions`) y los logs (`logs`) guardan el `user_id` del token y el servidor **siempre filtra** por él: un usuario no ve ni retoma las conversaciones de otro. **Los casos y sus paquetes también son por usuario** (los archivos van bajo `usuarios/<id>/`): el evaluador empieza limpio y no puede descargar los paquetes de Sofía. Migración: `supabase/migrations/003_user_id.sql`.
- `/api/paquetes/*` y las descargas exigen token (el front descarga con `fetch` y `Authorization`).
- **Conversaciones** (lateral izquierdo): las tuyas, las más recientes primero, con hora de Colombia, caso y estado (en curso, listo, bloqueado o incompleto). Una terminada se abre en solo lectura en el chat; una en curso se retoma. «Sesión nueva» no borra nada.
- Las pruebas fuerzan `AUTH=off` (`test/setup.ts`) aunque tu `.env` tenga `AUTH=on`.

## Módulo reutilizable (`modulo/`)

El agente empaquetado para otras plataformas, sin servidor: `agent.md`, `tools/proveedor.ts` y `skill/registro-proveedor/SKILL.md`. **Se genera, no se edita**: la fuente de verdad es `agent/prompt.md`, `src/knowledge/registro-proveedor.md` y `src/tools/proveedor.ts`.

```bash
bun run build:modulo   # regenera modulo/ después de cambiar una fuente
bun run check:modulo   # falla si modulo/ está desalineado (lo mismo que verifica test/modulo.test.ts)
```

Detalles de uso en [modulo/README.md](modulo/README.md).

## Variables de entorno

Ver [.env.example](.env.example). Las claves viven solo en el entorno del backend, nunca en el repo, el front ni los logs.

| Grupo | Variables |
|---|---|
| Almacenamiento | `STORAGE=local\|supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` |
| Acceso | `AUTH=on\|off`, `SUPABASE_ANON_KEY` |
| Modelos | `LLM_CHAIN`, `OPENAI_API_KEY/MODEL`, `GOOGLE_API_KEY/MODEL`, `DEEPSEEK_API_KEY/MODEL`, `LLM_TIMEOUT_MS` |
| Topes | `SESSION_TOKEN_CAP`, `MAX_ITERATIONS`, `GLOBAL_DAILY_USD_CAP`, `RATE_LIMIT_PER_MIN` |
| Negocio | `FECHA_REFERENCIA` (vigencia de soportes) |
| Admin | `RESET_KEY` (sin ella, el reset queda deshabilitado) |

## API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/chat` | `{sessionId, message, confirm?}` → `{reply, toolCalls, needsConfirmation, modo, aviso?, fechaReferencia}` |
| GET | `/api/sessions/:id` | Historial de la sesión |
| GET | `/api/casos?fecha=` | Bandeja: estado de cada caso a esa fecha |
| GET | `/api/casos/:caso?fecha=` | Panel del caso: campos con trazabilidad, soportes, decisiones, archivos y costo |
| POST | `/api/casos/:caso/procesar` | Procesa el caso sin modelo (no gasta tokens) |
| POST | `/api/casos/:caso/decisiones` | Confirmar un valor o dejarlo para revisar con el cliente |
| POST | `/api/casos/:caso/proponer-envio` | Deja pendiente la confirmación del envío en la sesión |
| GET | `/api/reporte?fecha=` | Faltantes entre todos los casos y costo por caso |
| GET | `/api/config` | Configuración pública del login (URL y clave anon); sin token |
| GET | `/api/sessions` | Historial del usuario: id, fecha y hora de Colombia, caso y estado |
| GET | `/api/health` | `{ok, provider, model, cadena, modo, fechaReferencia, storage}` (sin claves) |
| GET | `/api/paquetes/:caso` y `/api/paquetes/:caso/<archivo>` | Lista y descarga del paquete (ruta validada) |
| POST | `/api/reset` | Cabecera `x-reset-key`. Borra salidas, logs y sesiones; conserva el consumo diario |

## Base de datos (Supabase)

1. Ejecuta `supabase/schema.sql` y luego las migraciones `002_gasto_global.sql` y `003_user_id.sql` (SQL Editor).
2. Variables: `STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Despliegue en Vercel (desde GitHub)

1. En Vercel: *Add New → Project* y elige este repositorio (preset «Other»). **La función es `api/index.js`, un bundle versionado** (un solo archivo con todas sus dependencias, generado con esbuild desde `src/vercel.ts`). Se versiona porque Vercel detecta las funciones de `api/` **antes** de correr el build: un archivo generado durante el build no cuenta (error real `unused_function`), y un `api/index.ts` suelto falla con `ERR_MODULE_NOT_FOUND` por los imports sin extensión de un proyecto `"type": "module"`.
   - `vercel-build` **no reescribe nada**: solo comprueba que `api/index.js` exista (`scripts/verify-vercel.mjs`). El bundle versionado es la fuente.
   - `vercel.json` fija `outputDirectory: web`, reenvía `/api/*` a esa función (`maxDuration` 60 s) e incluye `fixtures/`, `agent/` y `src/knowledge/`.
   - **Después de cambiar algo en `src/`, `package.json` o `bun.lock`:** `bun run build:vercel && git add api/index.js` y haz commit del resultado.
   - **Candado:** `bun run check:vercel` regenera el bundle en memoria y falla si difiere del versionado; también corre dentro de `bun test` (`test/vercel.test.ts`), así que un bundle desactualizado no pasa las pruebas. `bun run verify` encadena typecheck, `check:modulo`, `check:vercel` y las pruebas.
   - El bundle es determinista: sin fechas, sin sourcemaps y con marcadores relativos a la raíz, así que no depende de la máquina ni del directorio desde el que se genere. Empieza con un comentario «Archivo generado por scripts/build-vercel.mjs — no editar a mano».
2. Carga las variables de `.env.example` (mínimo: `STORAGE=supabase`, `AUTH=on`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, al menos una clave de modelo y `RESET_KEY`).
3. Verifica con `GET /api/health`.

Antes de una demo, `POST /api/reset` con `x-reset-key` deja los casos limpios.
