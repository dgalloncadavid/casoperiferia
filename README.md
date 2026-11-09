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
| GET | `/api/health` | `{ok, provider, model, cadena, modo, fechaReferencia, storage}` (sin claves) |
| GET | `/api/paquetes/:caso` y `/api/paquetes/:caso/<archivo>` | Lista y descarga del paquete (ruta validada) |
| POST | `/api/reset` | Cabecera `x-reset-key`. Borra salidas, logs y sesiones; conserva el consumo diario |

## Base de datos (Supabase)

1. Ejecuta `supabase/schema.sql` y luego `supabase/migrations/002_gasto_global.sql` (SQL Editor).
2. Variables: `STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Despliegue en Vercel (desde GitHub)

1. En Vercel: *Add New → Project* y elige este repositorio. No hace falta Build Command: `vercel.json` ya fija `outputDirectory: web`, reenvía `/api/*` a `api/index.ts` (Hono sobre Node, `maxDuration` 60 s) e incluye `fixtures/`, `agent/` y `src/knowledge/` en la función.
2. Carga las variables de `.env.example` (mínimo: `STORAGE=supabase`, las dos de Supabase, al menos una clave de modelo y `RESET_KEY`).
3. Verifica con `GET /api/health`.

Antes de una demo, `POST /api/reset` con `x-reset-key` deja los casos limpios.
