# SOLUCION.md — Reto 1 «Registro como proveedor»

> Estado: **Pasos 1 a 7 entregados** (bonus `modulo/`, experiencia de Sofía, deploy en Vercel, layout con el chat al centro, login, historial y rediseño visual). Pendiente: confirmar el despliegue real en Vercel (ver §8).

## 1. Problema en una frase

Cada vez que un cliente quiere pagarle a Periferia, alguien del área administrativa transcribe a mano los mismos datos y busca los mismos soportes para llenar el formato del cliente; tras la salida de una persona ese trabajo se volvió lento, riesgoso y dependiente de quien sepa dónde está todo.

**A quién le duele**

- **La analista administrativa (Sofía):** transcribe campo por campo, busca soportes y arma el correo.
- **Periferia:** mientras no está registrada como proveedor no puede facturar; el retraso pega en el flujo de caja.
- **El representante legal:** firma lo que le llega; si hay un error en la cuenta o el NIT, firma un error.

Lo que se evalúa no es automatizar por automatizar sino **confianza**: nunca inventar un valor, marcar lo dudoso, bloquear la firma cuando falta o venció un soporte y pedir confirmación antes de cualquier acción externa.

## 2. Arquitectura

```
┌─────────────────┐  HTTPS   ┌──────────────────────────────────────────────────────────┐
│ Front (web/)    │ ───────▶ │ Backend Hono (Node) — src/server.ts, api/index.ts         │
│ - chat          │ ◀─────── │  /api/chat · /api/sessions/:id · /api/health              │
│ - tool calls    │          │  /api/paquetes/:caso/* · /api/reset                       │
│ - botón confirmar│         │                                                           │
│ - fecha de ref. │          │  ┌─ Ciclo del agente (src/agent/ciclo.ts) ─────────────┐  │
└─────────────────┘          │  │ prompt → modelo → herramientas → respuesta           │  │
                             │  │ confirmación, topes y modo sin modelo (servidor)     │  │
                             │  └──────────┬────────────────────────────┬─────────────┘  │
                             │             │                            │                │
                             │   Adaptador LLM (src/llm)        Herramientas (src/tools)  │
                             │   OpenAI-compatible              proveedor_* con zod       │
                             │   cadena openai→google→deepseek  ↓ núcleo determinista     │
                             │                                  (src/core: mapeo, soportes│
                             │                                   formulario, paquete…)    │
                             └─────────────────────┬──────────────────────┬──────────────┘
                                                   │                      │
                                    fixtures/ (solo lectura)     Storage (src/storage)
                                    maestro, glosario,           STORAGE=local  → out/   (demo.ts, desarrollo)
                                    soportes, casos              STORAGE=supabase → tablas sessions, logs,
                                                                   usage, rate_limits + bucket «paquetes»
```

**Dónde vive cada cosa** (la separación que pide el PRD §6.5):

| Capa | Archivo | Qué contiene |
|---|---|---|
| **Comportamiento** | [agent/prompt.md](agent/prompt.md) | Reglas del agente, cómo responde y el tono para Sofía. Sin lógica de negocio. |
| **Conocimiento** | [src/knowledge/registro-proveedor.md](src/knowledge/registro-proveedor.md) | Qué pide cada país, estados de un campo, vigencias, portal, paquete. Se concatena al prompt al armar el contexto. |
| **Ejecución** | [src/tools/proveedor.ts](src/tools/proveedor.ts) + [src/core/](src/core) | Las 5 herramientas (`proveedor_*`) y el núcleo determinista que las respalda. |

Un cambio de reglas de negocio (por ejemplo, el umbral de alerta de vigencia) toca `src/core/soportes.ts` y el conocimiento; el servidor no se entera.

**Principio de diseño: el código decide y el modelo conversa.** Ningún valor del formulario sale del modelo. El mapeo se recalcula siempre en el servidor con glosario y maestro; los argumentos que el modelo podría usar para manipularlo (`mapeo`, `campos`, `confirmado`) ni siquiera se le muestran en el esquema de herramientas y, si llegaran, se ignoran.

**Despliegue en Vercel.** El servidor es Hono sobre Node. Dos errores reales en producción dieron la forma actual: (1) un `api/index.ts` suelto fallaba con `ERR_MODULE_NOT_FOUND`, porque Vercel no reescribe los imports sin extensión de un proyecto `"type": "module"`; (2) generar `api/index.js` durante el build fallaba con `unused_function`, porque **Vercel detecta las funciones de `api/` antes de ejecutar el build** (la documentación no lo aclaraba). Por eso la función es un **bundle versionado**: `src/vercel.ts` se empaqueta con esbuild en `api/index.js` (un solo archivo con todas sus dependencias, determinista y con un comentario «generado, no editar»). `vercel-build` no lo reescribe, solo verifica que exista. Un **candado** (`bun run check:vercel`, también dentro de `bun test`) regenera el bundle en memoria y falla si difiere del versionado, para que nunca se suba uno desactualizado. Se verificó ejecutando el bundle con Node desde una carpeta tipo `/var/task` sin `APP_DIR`: responde `health` y la bandeja, procesa casos (xlsx y PDF) y sirve la descarga, y carga `agent/prompt.md` y `src/knowledge` desde `process.cwd()`.

**Almacenamiento.** Una interfaz `Storage` con dos implementaciones, elegidas con `STORAGE`:

- `local` (disco, `out/`): lo usan `demo.ts` y el desarrollo. Con `VERCEL` definido y sin `OUT_DIR`, escribe solo en `/tmp`.
- `supabase`: tablas `sessions` y `logs` (más `usage` y `rate_limits` de la migración 002) y el bucket privado `paquetes`. Producción en Vercel no depende del disco.

Las herramientas escriben todo a través de `Storage`; ni siquiera releer el xlsx para verificarlo toca el disco directamente.

**Pantalla de la analista (Pasos 5 y 6).** El **chat es el protagonista**: ocupa la columna central y es la más ancha, con los mensajes (de hasta unos 720 px de ancho), las tarjetas de confirmación «valor 1 de 2» y el botón de confirmar el envío fijos sobre el campo de texto. A la **izquierda**, una bandeja angosta (280 px) con los **casos** (estado como texto y un punto de color), las **conversaciones** del usuario, con la **fecha de referencia** arriba, luego **casos** y **conversaciones** que se reparten el alto al 50% (cada una con su scroll; cada ítem en dos líneas), un botón «Ver todos los casos» fijo al final de los casos (abre la tabla en `#/casos`) y «Reporte de faltantes y costo» fijo al pie (abre su vista en `#/reporte`); los dos son botones secundarios iguales, con el activo marcado con `aria-current`. Al abrir un caso se restaura su conversación más reciente. A la **derecha**, un **detalle plegable** (360 px) del caso elegido (campos con trazabilidad desplegable, soportes con semáforo, «Preparar envío»); cerrado por defecto, se abre al elegir un caso o al tocar un campo que el asistente menciona en el chat, y se cierra con el ícono `panel-right-close`. Elegir un caso abre su detalle y deja el chat enfocado en él (con una sugerencia escrita que **la persona** envía, nunca el sistema). Responsive: **menos de 1280 px** el detalle pasa a un drawer sobre el chat; **menos de 900 px** la bandeja también (ícono `panel-left`) y el chat ocupa todo; Esc cierra el drawer y devuelve el foco. Es HTML, CSS y JavaScript sin paso de build (`web/`), alimentado por endpoints que calculan todo **en vivo y sin modelo** con la fecha elegida (`GET /api/casos`, `/api/casos/:caso`, `/api/reporte`; `POST /api/casos/:caso/procesar`, `/decisiones` y `/proponer-envio`). Procesar desde el panel usa las mismas herramientas en orden (`processCaso`) y **no gasta tokens**.

**Sistema visual (Pasos 7 y 7.1).** Apariencia de SaaS silencioso y editorial, definida solo en CSS (la lógica, el layout de tres columnas y los textos no cambiaron): lienzo blanco, un solo azul de acento y estados como texto con un punto de 8px, nunca como pastilla; el Paso 7.1 le sumó un pulido «moderno»: contenedores con borde de 1px de baja opacidad y una sombra en capas muy suave (en oscuro, solo bordes), encabezado translúcido con blur, esqueletos de carga, estados vacíos con ícono y micro-interacciones de 150 a 200 ms. Todo el color sale de los tokens de `:root` en `web/styles.css` (claro y oscuro) y una prueba falla si aparece un color suelto, un radio fuera del vocabulario (6, 8, 12 y 16 px), una sombra no permitida o un tamaño de letra fuera de la escala. Tipografía: Inter para la interfaz y JetBrains Mono solo para identificadores, autoalojadas. Decisiones que se apartan del brief a propósito, todas por accesibilidad o por no tocar textos: (1) **los tonos de estado del diseño (`#ea580c`, `#16a34a`) no pasan AA como texto: sobre blanco dan 3,6:1 y 3,3:1 frente a 4,5:1, así que el punto conserva el color del diseño y solo el texto se oscurece** (`#b43c0a`, `#166534`; en oscuro se aclara); (2) `#737373` tampoco pasa como texto sobre `--paper` (4,35:1), así que el texto de metadatos usa `#666666`; (3) los campos de fecha usan borde `#737373` y no `#e5e5e5` (1,26:1) para cumplir el contraste de 3:1 de los componentes, mientras el chat y el login llevan el borde negro pedido; (4) el botón del login sigue diciendo «Ingresar» (no «Entrar») porque no se tocan los textos; (5) los ítems de la bandeja miden al menos 40 px, pero son más altos cuando llevan el estado y los motivos; (6) en el tema oscuro el botón primario se invierte (claro con texto oscuro) y el texto azul usa `#60a5fa`, ya que `#2563eb` no pasa como texto sobre negro, aunque sí como anillo de foco. **Apartamientos del Paso 7.1:** (7) la bandeja ahora marca la selección con fondo neutro y una **barra izquierda de 2px**, que contradice el «sin barra lateral» del Paso 7 porque el brief nuevo la pide; los tokens `--sel-bg` y `--sel-ink` quedan **sin uso** (se dejaron en `:root` para no tocar la paleta), y el token `--dots` se retiró porque el fondo del login pasó del patrón de puntos a un degradado radial de neutros; (8) el encabezado es translúcido, con blur y `sticky`, pero **su efecto es casi invisible**: los paneles se desplazan por dentro y nada pasa por debajo; (9) el composer conserva el borde negro de 1px (no se pidió quitarlo y garantiza el contraste de 3:1 del campo) y suma la sombra suave; (10) la tarjeta del login pasa a radio 12 (consistente con las tarjetas) y los drawers conservan 16 y el anillo; (11) «Regla» llega **plegada también en escritorio** (antes iba abierta) y se anima con una transición de filas de grid, no con `<details>`, que no anima la altura en todos los navegadores; (12) el botón Enviar es solo un ícono, con el nombre accesible «Enviar»; (13) el esqueleto de carga late en ciclos de 1,2 s (es un indicador de carga, no una transición; se desactiva con «reducir movimiento»); (14) el ícono grande del estado vacío usa trazo de 1.5 y no 1.75; (15) se marcaron como `aria-hidden` todos los íconos decorativos, que antes un lector de pantalla podía anunciar.

**Acceso y datos por usuario (Paso 4.1).** Login con **Supabase Auth y usuarios fijos** (supuesto 26): el front inicia sesión con `@supabase/supabase-js` y la clave pública `anon` (que recibe por `GET /api/config`; la service role nunca sale del servidor) y manda el token como `Bearer`. Un middleware valida cada petición a `/api/*` con `supabase.auth.getUser` (con caché de 60 s) y responde `401` si no es válida, salvo `/api/health` y `/api/config`. `AUTH=on|off` controla el login; sin definir, en Vercel es `on` (falla cerrado). Las conversaciones y los logs guardan el `user_id` del token y **el servidor siempre filtra por él**: el dueño sale del token y no del cuerpo de la petición, y una conversación ajena se ve igual que una inexistente (404). **Los casos y sus paquetes también son por usuario** (supuesto 27): los archivos viven bajo `usuarios/<id>/`, así que la bandeja, el estado, las decisiones, los envíos y las descargas de cada persona son solo suyos y el evaluador empieza limpio. Las **conversaciones** se listan en la bandeja, las más recientes primero, con hora de Colombia, caso y estado; una terminada se abre en solo lectura en el chat central y una en curso se retoma. Si el token vence, el front vuelve al ingreso **sin perder la conversación ni lo que estabas escribiendo**.

**Módulo reutilizable (bonus, PRD §9.4).** La carpeta [modulo/](modulo) empaqueta el agente para otras plataformas **sin depender del servidor**: `agent.md` (frontmatter `mode: primary`, `edit: deny`, `bash: deny`; el cuerpo es el system prompt), `tools/proveedor.ts` (las 5 herramientas en un solo archivo, que solo importa `zod`, `exceljs`, `pdf-lib` y `node:*`) y `skill/registro-proveedor/SKILL.md` (el conocimiento). Hay **una sola fuente de verdad**: la aplicación lee `agent/prompt.md`, `src/knowledge/registro-proveedor.md` y `src/tools/proveedor.ts`, y `bun run build:modulo` genera `modulo/` desde esos mismos archivos; nada en `modulo/` se edita a mano. [test/modulo.test.ts](test/modulo.test.ts) **falla si el módulo se desalinea** (si cambia una fuente sin regenerar, o si alguien retoca `modulo/` a mano) y comprueba que el módulo **funciona sin el servidor**: en una carpeta aislada, con solo `modulo/` y `fixtures/` (sin `src/` ni `agent/`), da los mismos resultados que las herramientas de la aplicación en los 4 casos.

## 3. Ciclo del agente

Implementado en [src/agent/ciclo.ts](src/agent/ciclo.ts), independiente del proveedor (solo conoce `enviar(mensajes, herramientas)`).

1. **Contexto.** Prompt + conocimiento + la fecha de referencia vigente + los mensajes de la sesión (solo texto de usuario y asistente; las herramientas se reejecutan si hace falta) + el mensaje nuevo.
2. **Bucle** (máximo `MAX_ITERATIONS`, por defecto 25 por turno): se llama al modelo; si pide herramientas, el servidor las valida con zod y las ejecuta; el resultado vuelve al modelo. Cuando responde sin pedir herramientas, termina. Al alcanzar el tope responde con lo que hizo (CA1).
3. **Cada llamada** queda visible en el chat (nombre, argumentos y resumen del resultado, sin valores del formulario) y en `log.jsonl` (CA4, RN5).
4. **Confirmación controlada por el servidor** (CA3, RN4):
   - Tras armar un paquete (o si el modelo pide `proveedor_simular_envio`), el servidor guarda `pendiente = {caso, acción}` en la sesión y cierra el turno con la pregunta de confirmación, redactada por el servidor. Si el paquete está incompleto, la pregunta es **reforzada**: lista los bloqueadores y los campos faltantes y avisa que el envío quedará marcado INCOMPLETO.
   - Solo la libera el **botón estructurado** de la interfaz (`confirm: true`) o el mensaje exacto «envía» en el turno **inmediatamente siguiente**. Cualquier otro mensaje la cancela y se avisa.
   - El `confirmado` que mande el modelo se ignora: ni siquiera aparece en el esquema que ve.
   - Al confirmar, el servidor ejecuta `simular_envio` sin llamar al modelo. Es idempotente: repetirlo devuelve el envío existente.
5. **Topes** (todos configurables): `SESSION_TOKEN_CAP` = 60.000 tokens por sesión; `GLOBAL_DAILY_USD_CAP` = 5 USD de gasto diario global (guardado en Supabase); `RATE_LIMIT_PER_MIN` = 20 mensajes por minuto por IP (hash de la IP, también en Supabase); mensajes de hasta 2.000 caracteres.
6. **Modo sin modelo.** Si no hay proveedor configurado, todos fallan por créditos/límite/tiempo, o se pasa el tope de sesión o el global, el chat usa `processCaso()` (las mismas herramientas, en orden, sin modelo), lo avisa en pantalla y mantiene la confirmación. El gasto se calcula con una tabla de precios configurable (`LLM_PRICES`).
7. **Errores** (CA5). Un error del proveedor se muestra en lenguaje claro, sin el texto crudo del proveedor, y la sesión sigue viva. Si el modelo falla a mitad de turno, las llamadas ya hechas siguen visibles.

## 4. Elección del modelo

**Proveedor y adaptador.** Una sola implementación compatible con OpenAI (`/chat/completions`) sirve para los tres proveedores; Gemini y DeepSeek se usan por sus endpoints compatibles. Cambiar de proveedor no toca el ciclo del agente. La cadena es `LLM_CHAIN=openai,google,deepseek` y **solo** pasa al siguiente por créditos agotados, límite de velocidad o tiempo agotado (nunca por errores de contenido), registrando cada cambio en el log (`llm_failover`). Si fallan todos: modo sin modelo.

| Proveedor | Modelo (variable de entorno) | Por qué |
|---|---|---|
| OpenAI | `gpt-4.1-mini` (`OPENAI_MODEL`) | Primero en la cadena: el más rápido y estable en las mediciones, llama bien a herramientas. |
| Google | `gemini-3.1-flash-lite` (`GOOGLE_MODEL`) | Económico y vigente. `gemini-2.5-flash` figura en el listado pero responde 404 en cuentas nuevas. |
| DeepSeek | `deepseek-flash` (`DEEPSEEK_MODEL`) | Económico y vigente. `deepseek-chat` ya no existe en la API; hoy hay `deepseek-flash` y `deepseek-v4-pro`. |

Los modelos van por variable de entorno, no fijos en el código. `scripts/check-models.ts` no solo lista modelos: hace una llamada real con herramientas, porque un modelo puede aparecer en el listado y rechazar cuentas nuevas (le pasó a Gemini 2.5).

### Comparación medida: Corp Andina de punta a punta

Medición del 2026-11-09: primer turno del PRD §11 (el prompt completo de Corp Andina), secuencial, con sesión nueva en cada corrida y fecha de referencia 2026-09-03. Datos crudos en [docs/comparacion-proveedores.md](docs/comparacion-proveedores.md) y [docs/comparacion-cadena.md](docs/comparacion-cadena.md); transcripciones completas en [docs/transcripciones/](docs/transcripciones/).

Una corrida es un **éxito** solo si llamó las 4 herramientas, pidió confirmación y su respuesta menciona el campo faltante, el soporte ausente y el RUC por confirmar, y reporta 13 campos llenos.

| Configuración | Modelo | Éxitos | Tiempo en s (mín / mediana / máx) | Tokens por corrida (promedio) | Cambios de proveedor |
|---|---|---|---|---|---|
| Solo OpenAI | `gpt-4.1-mini` | **5/5** | 4,3 / 4,7 / 6,1 | 13.101 | no aplica |
| Solo Google | `gemini-3.1-flash-lite` | **4/5** | 5,3 / 7,5 / 15,3 | 9.354 | no aplica |
| Solo DeepSeek | `deepseek-flash` | **5/5** | 7,4 / 8,7 / 11,1 | 19.116 | no aplica |
| Cadena con Google primero (peor caso) | `gemini-3.1-flash-lite` → `gpt-4.1-mini` → `deepseek-flash` | **6/6** | 4,3 / 5,9 / 30,7 | 13.779 | 3 de 6 corridas (`google:timeout` y `google:limite`) |

**Lectura de los resultados**

- **OpenAI** fue el más rápido y estable: 5 de 5, con muy poca variación de tiempo y de tokens. Por eso va primero en la cadena de producción.
- **DeepSeek** acertó 5 de 5 pero es más lento (mediana de 8,7 s) y gasta más tokens por caso.
- **Gemini** falló 1 de 5: un **429 por límite de velocidad** a mitad del turno, tras 4 corridas seguidas, y el chat lo mostró como «No pude consultar el modelo (límite de velocidad)», sin romper la sesión. Los tiempos y los tokens son los más variables (de 5,3 a 15,3 s y de unos 6,5 mil a 15,8 mil tokens por caso; no investigué por qué algunas corridas gastan más).
- **Fuera de esta serie sistemática**, durante las corridas de verificación de Gemini vi además al menos 2 timeouts de 25 s y 1 error 503 de «alta demanda» del proveedor, y antes de corregir el adaptador, el 400 por falta de `thought_signature` (supuesto 20). Con `gemini-2.5-flash`, 404 en todas las llamadas. Son anécdotas de cuándo ocurrieron, no una tasa.

**Cómo cubre estos fallos la cadena.** Se probó con **Gemini primero a propósito**, que es el peor caso: en **3 de 6 corridas** Gemini falló (por timeout o por límite de velocidad) y la cadena pasó al siguiente proveedor; el resultado fue **6 de 6 exitosas**. El costo del rescate es tiempo: una corrida tardó 30,7 s (25 s del timeout de Gemini y luego la respuesta de OpenAI), frente a unos 4 a 6 s sin cambios. Dentro del tope de 60 s de la función de Vercel, pero con poco margen si dos proveedores seguidos fallan por timeout (riesgo en §10).

**Límites de esta medición.** Son 5 o 6 corridas por configuración, de un solo día y a una hora concreta; no sirven para una tasa estadística, solo para ver el orden de magnitud y los modos de fallo. Los fallos de Gemini son de disponibilidad del proveedor (los modelos preview van con alta demanda), no de formato de herramientas. La cadena se probó además de forma controlada (OpenAI simulado con «sin cuota» → Gemini real, con el cambio registrado en el log) y con pruebas unitarias.

### Costo por caso (estimación)

Cada caso consume **un turno con modelo** (leer, mapear, generar y armar: 4 llamadas al proveedor); el turno de confirmación «envía» lo ejecuta el servidor y no consume tokens.

- **OpenAI (`gpt-4.1-mini`), medido:** en las 5 corridas, 4 peticiones y 12.786 tokens de entrada + 281 a 345 de salida por caso. La entrada pesa tanto porque cada una de las 4 llamadas reenvía el prompt, el conocimiento y los resultados anteriores.
- **Precio usado: 0,40 USD de entrada y 1,60 USD de salida por millón de tokens. Es una cifra recordada, no verificada contra la página oficial en esta sesión: tómese como estimación.** Con ella, un caso cuesta unos **0,0056 USD** (medido por el sistema entre 0,0055 y 0,0057 en las 5 corridas), y 8 a 12 casos al mes serían menos de 0,07 USD. El gasto diario acumulado del servicio se calcula con la misma tabla.
- **Gemini y DeepSeek:** los tokens están medidos (tabla de arriba), pero **no tengo confirmado su precio y no lo inventé**. Si un modelo no está en la tabla, el código aplica un valor conservador por defecto (1 USD de entrada y 4 USD de salida por millón) que **no es el precio de ese proveedor**: solo sirve para que el tope de gasto sobrestime en vez de subestimar. Los precios reales se cargan con `LLM_PRICES` y mientras tanto el gasto de esos dos modelos es una cota superior, no una cifra.
- Las cifras en dólares de este documento son estimaciones; los **tokens** y los **tiempos** son medidos.

## 5. Diseño del portal web (solo documentación, PRD §7.4)

**No se implementa.** Hoy el agente responde «formato no soportado» y entrega `valores-portal.md` con los valores en el orden del formulario, marcando por confirmar y faltantes. El diseño para automatizarlo:

**Estrategia (de menos a más riesgo)**

1. **Asistida (recomendada como primera fase):** una extensión de navegador que la analista tiene abierta en la sesión que ella inició. Lee `valores-portal.md` y rellena los campos de la página actual; no navega ni envía. Es la de menor superficie de ataque y sirve incluso con CAPTCHA o MFA, porque la persona ya pasó esas barreras.
2. **Navegador controlado por el agente** (Playwright u otro): el agente abre el portal, mapea etiquetas del portal contra el glosario y rellena. Se detiene ante cualquier CAPTCHA, MFA o cambio de layout inesperado y pasa el control a la persona.
3. **RPA clásico por portal:** solo para portales de alto volumen, con un script por cliente y mantenimiento propio.

**Límites reconocidos:** CAPTCHA y MFA se hacen para impedir justo esto y no se eluden; los cambios de layout rompen selectores (mitigación: seleccionar por etiqueta visible y no por posición, y fallar con un reporte claro); campos dinámicos o cargas de archivos pueden requerir pasos manuales; los términos de uso de un portal pueden prohibir la automatización y hay que revisarlos cliente por cliente.

**Credenciales**

- Nunca en el repositorio, nunca en el prompt, nunca en los logs, nunca en la conversación. En el caso `pa-logistica-istmo` el PRD ya indica que se enviaron por separado al correo del representante legal: el agente **no las recibe**.
- Las ingresa la persona en su propio navegador. Si algún día se guardan, irían en un gestor de secretos con acceso del humano, no del agente.

**Qué hace el agente y qué hace el humano**

| Paso | Quién |
|---|---|
| Leer la solicitud, mapear, preparar `valores-portal.md` y los soportes a cargar | Agente |
| Ingresar usuario, contraseña y resolver CAPTCHA / MFA | **Humano** |
| Rellenar los campos del formulario (fase 1: asistida; fase 2: agente) | Agente, con el humano mirando |
| Revisar los campos por confirmar y los faltantes | **Humano** |
| Cargar los soportes | Agente prepara, humano verifica |
| **Clic en «Enviar»** | **Humano** |

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | La **confirmación vive en el servidor** (`pendiente` en la sesión; botón o «envía» inmediatamente después). | Confiar en el prompt para que el modelo pida y valide la confirmación. | Un prompt se puede saltar con una inyección en el correo del cliente. Con el servidor, aun si el modelo pidiera enviar con `confirmado: true`, no se ejecuta (prueba: `el confirmado: true que manda el modelo se ignora`). |
| 2 | El **mapeo es determinista** (código + glosario) y se recalcula siempre. | Dejar que el modelo mapee o complete campos. | El riesgo central del PRD es que el modelo «complete» un valor plausible. Con el código decidiendo, un campo sin fuente es `faltante` y no hay forma de inventar. |
| 3 | **Un adaptador OpenAI-compatible** para los tres proveedores. | SDK propio de cada proveedor. | Menos dependencias, un solo punto de pruebas y failover trivial. Costo: hay particularidades que absorber en el adaptador (Gemini 3 exige devolver `thought_signature`; DeepSeek cambió de modelos). |
| 4 | **Supabase** (tablas y bucket) además del disco local. | Solo disco local, que el PRD acepta. | Vercel es serverless y su disco es efímero: las sesiones, la confirmación pendiente y los topes globales se perderían entre invocaciones. El disco se conserva para `demo.ts`. |
| 5 | **Modo sin modelo** con `processCaso()` como respaldo. | Mostrar un error y detenerse al fallar el modelo o superar un tope. | La analista sigue trabajando aunque se acaben créditos o el proveedor esté caído; el costo es mantener una respuesta determinista paralela, que además sirve de prueba. |
| 6 | La memoria entre turnos guarda **solo texto**; las herramientas se reejecutan. | Persistir todos los mensajes de herramientas. | Menos tokens y menos datos sensibles guardados. Costo: una pregunta de seguimiento puede repetir una llamada barata y determinista. |
| 7 | **Generar el xlsx desde `plantilla-celdas.json`** (celdas de texto, releído y verificado). | Abrir y rellenar una plantilla `.xlsx` binaria. | Los fixtures no traen el `.xlsx`, solo la descripción de celdas (supuesto 16). Costo: no se preserva el estilo original del cliente. |

## 7. Supuestos

1. **No hay rúbrica.** Se diseña contra las 5 herramientas, CA1 a CA5, RN1 a RN5, HU-1 a HU-5, la sección 9 y los requisitos no funcionales, y todo va en una tabla de cobertura (§8).
2. `FECHA_REFERENCIA` es **2026-09-03** por defecto, configurable y visible. `demo.ts` también imprime una corrida con la fecha real.
3. «Cámara no mayor a 30 días» se interpreta con `vigencia_hasta`: alerta amarilla si quedan menos de 30 días y roja si quedan menos de 15.
4. El NIT llena RUC y RTN según RN1 y esos campos quedan por confirmar. El dígito de verificación solo aplica a Colombia.
5. «Correo electrónico» se toma del contacto comercial, como indica el glosario.
6. Los ingresos se escriben como «98.000.000.000 COP (2025)», quedan por confirmar y no se convierte la moneda.
7. Contribuyente especial y referencias comerciales quedan como faltantes, no bloquean y aparecen en el checklist.
8. Un soporte ausente o vencido bloquea `listo_para_firma`, pero no bloquea el envío simulado. En ese caso la confirmación es reforzada y el envío queda marcado como incompleto (PRD §11).
9. Un soporte de otro país se incluye con una advertencia, sin bloquear.
10. El portal genera `valores-portal.md` y las credenciales nunca pasan por el agente.
11. Los resultados esperados los derivamos nosotros de los fixtures.
12. El costo se calcula con los tokens reales y una tabla de precios configurable, y se presenta como estimación.
13. Los datos bancarios van solo en el formulario cuando la plantilla los pide, nunca en el borrador de correo, y `demo.ts` lo verifica.
14. Umbrales de confianza: 1.0 si la etiqueta es exacta, 0.9 si coincide sin tildes ni mayúsculas, 0.7 cuando aplica una regla. Por debajo de 0.8 queda por confirmar y nunca se adivina por aproximación.
15. «CO» se convierte en «Colombia» con un diccionario fijo y el campo cuenta como lleno. No es una regla, así que no baja la confianza.
16. El **xlsx se genera desde `plantilla-celdas.json`**, con valores como texto; los fixtures no incluyen una plantilla `.xlsx`. Para la plantilla corrupta se usa un JSON dañado en `fixtures-test/`.
17. Los **errores pueden llevar un campo opcional `parcial`** (además de `{ok:false, error}`) con lo que sí se pudo hacer. Se usa, por ejemplo, en el portal: «formato no soportado» más la ruta de `valores-portal.md` (HU-5: seguir con lo que sí se puede hacer).
18. **En el portal no hay envío que simular**: `proveedor_simular_envio` devuelve error (`formato_no_soportado`); el alta y el clic en «Enviar» los hace una persona.
19. El argumento **`campos` de `proveedor_mapear_campos` se ignora**: los campos siempre se toman de la plantilla del caso (igual que `mapeo`), para que el modelo no pueda introducir etiquetas inventadas.
20. **`thought_signature` es obligatoria en Gemini 3.** Verificado contra el endpoint compatible con OpenAI: devolver el historial de una llamada a herramienta sin esa firma produce un 400 («Function call is missing a thought_signature»); con ella, 200. El adaptador conserva el `extra_content` de cada llamada y lo reenvía **solo a Gemini**; si el historial viene de otro proveedor (failover a mitad de turno) usa el valor neutro documentado por Google, `skip_thought_signature_validator`. Esta última parte está cubierta por prueba unitaria, **no** por una corrida real de failover hacia Gemini.
21. **El módulo `modulo/` no incluye el servidor ni Supabase.** Guarda en disco local (`out/` de la raíz anfitriona, que debe contener `fixtures/reto-01/`). Sin servidor, nadie impone la confirmación del envío: en el módulo la protección es la regla 3 del prompt más el argumento `confirmado` de `proveedor_simular_envio`, que la plataforma anfitriona debe poner en `true` solo tras una confirmación humana explícita. Por eso el prompt es **una sola pieza válida en ambos contextos** (describe los dos casos), en vez de un prompt distinto para el módulo.
22. **Estados de la bandeja.** *Nuevo*: todavía no se procesó. *Necesita tu decisión*: hay valores por confirmar sin confirmar, o algún soporte vencido o ausente **a la fecha elegida** (los campos faltantes no cuentan: no bloquean la firma, supuesto 7). *Listo para firma*: nada de lo anterior (en un portal se muestra como «Listo para copiar al portal»). *Enviado*: existe la constancia del envío simulado. Los estados se calculan en vivo, así que cambian al cambiar la fecha.
23. **Solo el número de cuenta se enmascara** (`•••• 2345`) en el chat, en lo que se guarda de la sesión y en el panel. El banco, el tipo de cuenta, el titular y el SWIFT se muestran. El número completo va únicamente en el formulario (y en `valores-portal.md`, que es el formulario del portal) y esos archivos se descargan sin autenticación (ver §10; con `AUTH=on` solo las descarga el usuario dueño del caso, con su token).
24. **Confirmar o «revisar con el cliente» un valor se guarda para la trazabilidad y para el estado de la bandeja, pero no cambia el formulario ya generado** ni permite escribir otro valor: ningún valor del formulario sale de una persona ni del modelo, solo del maestro.
25. **El costo por caso reparte el gasto de cada turno con modelo, por igual, entre los casos que ese turno tocó.** Un turno que no toca ningún caso solo cuenta en el gasto global. Es una estimación con la tabla de precios configurada (supuesto 12). Procesar desde el panel y el modo sin modelo cuestan cero.
26. **Login con usuarios fijos, sin registro** (numerado 26 porque los supuestos 22 a 25 ya existían). Hay dos usuarios creados a mano en Supabase Auth (`sofia@casoperiferia.dev` y `evaluador@casoperiferia.dev`); no hay registro público ni recuperación de contraseña, y **las contraseñas no están en el repositorio: se entregan a quien evalúa por correo**. Que el registro público esté desactivado es un ajuste del proyecto de Supabase, no de este código.
27. **Los datos son por usuario, incluidos los casos.** Las conversaciones y los logs guardan el `user_id` (columnas de la migración 003); los archivos de cada caso (paquete, estado, constancia del envío, decisiones, costo) se escriben bajo `usuarios/<id>/`. Por eso la bandeja y el estado de los casos son por usuario y **el evaluador empieza limpio** aunque Sofía ya haya trabajado. Lo que **no** se separa: los fixtures de entrada (el maestro y los 4 casos), el consumo diario de modelo y el límite de velocidad, que son globales. Con `AUTH=off` no hay usuario y todo es compartido. El reset (`/api/reset`) borra los espacios de todos.
28. **El bundle de la función se versiona** (`api/index.js`, ~5 MB) en vez de generarse en el build de Vercel, porque Vercel detecta `api/` antes del build (error real `unused_function`). Costo aceptado: un archivo grande en el repositorio y un diff ruidoso cada vez que cambia el código del servidor. Mitigación: el candado `check:vercel` en las pruebas, que impide subir un bundle que no coincida con las fuentes. Limitación: el bundle depende de las versiones de `bun.lock`; si cambian las dependencias hay que regenerarlo.
29. **Vista «Todos los casos» (Paso 8): definiciones de la tabla.** Es la ruta `#/casos` (el hash permite el botón atrás y enlazar la vista; `#/` vuelve al asistente) y se alimenta de `GET /api/casos/resumen?fecha=` (con token, por usuario, calculado en vivo y sin modelo). Definiciones: **Campos llenos** = campos con estado «lleno» sobre el total del formulario (el caso aún no procesado muestra «—», no 0/N); **Por confirmar** = valores pendientes que la persona todavía no confirmó; **Soportes vencidos o faltantes** = conteo con el nombre del soporte; **Última actualización** = el movimiento más reciente de ese usuario en el caso (log o decisión), en hora de Colombia. El detalle (Campos, Soportes, Decisiones) reutiliza `GET /api/casos/:caso`, que ahora devuelve también las decisiones con su fecha (valores sensibles enmascarados como en el panel). «Abrir en el asistente» solo pone el caso en foco y deja escrita la sugerencia: **no envía nada al modelo**. Limitaciones: las columnas se ordenan en el navegador (no hay paginación: son 4 casos y el volumen real lo exigiría) y con 390 px la tabla se reemplaza por filas apiladas, no por una tabla comprimida.
30. **Estado único, conversación restaurada y lateral compacto (Paso 8.1).** (a) La bandeja, la tabla y el detalle salen de la misma fuente, `GET /api/casos/resumen` (y `GET /api/casos/:caso` para el panel, que usa la misma función de vista): el front guarda una sola copia y la vuelve a pedir tras procesar, confirmar, revisar, preparar el envío, cada turno del chat y cada cambio de fecha; antes la bandeja podía quedarse en «Nuevo» mientras la tabla ya decía «Necesita tu decisión». (b) Al abrir un caso (desde la bandeja, la tabla o «Abrir en el asistente») se carga la **conversación más reciente de ese usuario para ese caso**: si sigue en curso se retoma y si terminó se abre en solo lectura; si el caso no tiene ninguna, se deja el saludo (o uno limpio si el chat en pantalla era de otro caso). «Sesión nueva» abre una conversación limpia para el caso en foco. «Más reciente» se decide con el último caso que tocó cada conversación, que es el dato que ya guarda el historial. Con más de una, un enlace bajo el encabezado del chat filtra el historial por ese caso. Todo sale de `/api/sessions`, ya filtrado por `user_id`; la sesión de otro usuario responde 404. (c) El lateral reparte el alto al 50% entre CASOS y CONVERSACIONES, cada una con scroll propio; con 4 casos caben sin scroll a 1440×900, pero con pantallas más bajas o más casos hay scroll interno. Para que el ítem quepa en dos líneas el nombre del cliente se trunca con puntos suspensivos (el nombre completo está en el `title`, en la tabla y en el panel) y el detalle largo de soportes salió del ítem: queda un resumen («2 por confirmar · 1 soporte vencido»).
31. **El reporte es una vista propia, no un panel (Paso 8.3).** «Reporte de faltantes y costo» vive en `#/reporte`, a ancho completo y con su propio título, y se llega con un botón del lateral (igual que la tabla de casos); ya no se abre en el panel derecho. Usa el mismo endpoint y el mismo cálculo de antes (`GET /api/reporte`), con la fecha de referencia vigente, y se vuelve a pedir con el resto del estado compartido (supuesto 30). Con 390 px la tabla por caso pasa a filas apiladas y «Volver al asistente» queda arriba. Efecto lateral: se corrigió que en 390 px la tabla de casos quedaba a 280 px de ancho por una regla de la cuadrícula.

## 8. Cobertura

Estados: **hecho** (con prueba), **parcial** (con qué falta) o **no hecho**. «demo» = `bun demo.ts`; las pruebas están en `test/` y se corren con `bun test` (la prueba de almacenamiento incluye el proyecto real de Supabase cuando hay claves).

### Historias de usuario

| Historia | Criterio | Estado | Prueba |
|---|---|---|---|
| **HU-1** Leer la solicitud | Lista de campos, país, formato y soportes exigidos | Hecho | demo: los 4 casos (17/15/11/9 campos) |
| | Campo ambiguo → `requiere_confirmacion` y equivalente del país | Hecho | demo: «etiqueta ambigua», propone RUC en Ecuador; `reglas.test`: ambigua o de otro país |
| **HU-2** Mapear | Tres estados con la ruta del maestro | Hecho | `reglas.test`: etiqueta exacta → lleno con `ruta_maestro`; demo: por confirmar y faltantes de cada caso |
| | Nunca inventa; sin fuente = faltante | Hecho | `reglas.test`: sin parecido y dato ausente; demo: «sin parecido» |
| | Sinónimos del glosario | Hecho | `reglas.test`: 0.9 sin tildes ni mayúsculas; demo: «telefono» → 0.9 |
| **HU-3** Formulario | P0 xlsx en hoja y celda indicadas | Hecho | demo: releído y comparado celda a celda; ceros a la izquierda |
| | P1 PDF con todos los campos, etiqueta y valor, en orden | Hecho | `pdf.test` (extrae el texto del PDF y verifica orden y valores) |
| | P2 portal: «formato no soportado» + `valores-portal.md` | Hecho | demo: PA |
| **HU-4** Paquete | Carpeta con formulario, soportes, `checklist.md` y borrador | Hecho | demo: cada caso |
| | Vencido bloquea `listo_para_firma` | Hecho | demo: HN; `reglas.test`: umbrales y vencimiento |
| | Resumen en el chat y pregunta explícita; «enviar» solo escribe `ENVIO-SIMULADO.md` | Hecho | `agent.test`: pregunta reforzada y «envía» |
| **HU-5** Errores | Mensaje claro sin traza; el proceso continúa | Hecho | demo: plantilla corrupta, caso inexistente, nombres inválidos; continúa con el checklist |
| | Ninguna herramienta lanza | Hecho | demo: argumentos vacíos → `{ok:false}`; `agent.test`: argumentos inválidos |

### Reglas de negocio (RN), ciclo del agente (CA) y objetivos (O)

| Regla | Estado | Prueba |
|---|---|---|
| **RN1** Identificador por país | Hecho | demo: EC (RUC) y HN (RTN) por confirmar; `reglas.test`: nota «identificador extranjero» |
| **RN2** Datos bancarios solo si se piden y nunca en el correo | Hecho | demo: borrador de cada caso, e inyección |
| **RN3** Vencido o ausente bloquea; un faltante no | Hecho | demo: EC (ausente), HN (vencido), «los faltantes no figuran entre los bloqueadores» |
| **RN4** Ninguna acción externa sin confirmación en el turno inmediato | Hecho | `agent.test`: «envía» inmediato, botón, cancelación por otro mensaje, `confirmado` del modelo ignorado |
| **RN5** Log por caso `{ts, herramienta, ok, resumen}` | Hecho | demo: logs global y por caso, y sin datos bancarios |
| **CA1** Tope de iteraciones | Hecho | `agent.test`: tope de iteraciones |
| **CA2** El modelo no afirma valores que no vengan de una herramienta | Hecho (por diseño y prompt) | `agent.test`: el modelo no ve `mapeo`, `campos` ni `confirmado`; demo: el argumento `mapeo` se ignora. Contra las alucinaciones del texto en sí: ver §10 |
| **CA3** Confirmación humana y front que la resalta | Hecho | `agent.test` (servidor); front verificado con Chrome (botón «Confirmar envío» y recuadro resaltado) |
| **CA4** Llamadas visibles en el chat y en el log | Hecho | `agent.test`: herramientas visibles; demo: logs |
| **CA5** Error del proveedor claro y la sesión no muere | Hecho | `agent.test`: error no recuperable, error a mitad de turno |
| **O1** Cero transcripción en xlsx y PDF | Hecho | demo: CO, EC y HN |
| **O2** Lo que falta queda en un reporte de faltantes | Hecho | demo + `checklist.md` |
| **O3** Paquete para firma con pedido de confirmación | Hecho | `agent.test` |

### Requisitos no funcionales y entregables

| Requisito | Estado | Evidencia / qué falta |
|---|---|---|
| Arranque en un comando y menos de 2 minutos | Hecho | `bun run dev` (README) |
| Determinismo de `demo.ts`; `out/` se limpia al inicio | Hecho | dos corridas consecutivas con los mismos md, pdf y json |
| Seguridad: claves solo en el entorno; sin shell | Hecho | `/api/health` sin claves (test); búsqueda de claves en el árbol; las herramientas no ejecutan shell |
| Costo: tope de iteraciones, tokens por sesión, gasto global y límite por IP | Hecho | `agent.test` y `server.test` |
| Robustez: errores tipados, timeout al proveedor, un caso malo no frena el siguiente | Hecho | `agent.test`: timeout y red; demo |
| Legibilidad: TypeScript sin `any`, funciones cortas | Hecho (revisado con búsqueda) | `tsc --noEmit` limpio y sin `any` en `src`, `api`, `scripts`, `test` ni `demo.ts` |
| Dependencias justificadas | Hecho | `zod` (obligatorio), `exceljs` (xlsx), `pdf-lib` (PDF), `hono` (API portable a Vercel), `@supabase/supabase-js` (almacenamiento), `pdfjs-dist` (solo prueba del PDF) |
| `SOLUCION.md` con las 10 secciones | Hecho | este documento |
| `README.md` | Hecho | cómo levantar, variables, API, despliegue |
| **Enlace público** | **Pendiente de confirmar** | Lo despliega Diego desde la conexión de Vercel. Los dos primeros intentos fallaron por causas ya corregidas (ver §2, «Despliegue en Vercel»): `ERR_MODULE_NOT_FOUND` y `unused_function`. La función ahora es un bundle versionado con candado en las pruebas. **Falta ver el despliegue real.** `vercel build` local sigue sin ejecutarse (exige un proyecto enlazado). |
| Login con usuarios fijos y datos por usuario (Paso 6) | Hecho | `test/auth.test.ts` (401 sin token incluidas las descargas, aislamiento de conversaciones y de casos y paquetes, orden, estados, hora de Colombia, la service role no sale en ninguna respuesta), `test/ambito.test.ts` (el almacenamiento por usuario), contrato de almacenamiento con el Supabase real (`user_id` con claves foráneas) y una prueba en Chrome de punta a punta con 77 comprobaciones (login, layout a 1440, 1100 y 390 px, drawers, historial, solo lectura, retomar, descargas con token, sesión vencida, Salir) y axe sin violaciones contra un Supabase Auth simulado con el código real del servidor. **Con las contraseñas reales no se probó:** solo se comprobó con el Supabase real que un token falso se rechaza. |
| Rediseño visual (Pasos 7 y 7.1) | Hecho | `test/contraste.test.ts` (28 comprobaciones: contraste AA con 50 pares de texto y 16 de campos, foco y puntos por tema, más las reglas del sistema visual convertidas en pruebas) y 82 comprobaciones con estilos calculados en Chrome en claro, oscuro y drawers (fuentes, radios, sombras de los tokens, encabezado sticky con blur, selección con barra de 2px, composer, jerarquía de la tarjeta de decisión, regla con animación de altura, panel derecho sin tarjetas anidadas, micro-interacciones, esqueletos con la red retrasada y estado vacío), con axe sin violaciones. El recorrido funcional (78 comprobaciones) sigue pasando. Apartamientos del brief y su motivo: ver §2, «Sistema visual». |
| Lateral reorganizado y vista de casos en tabla (Paso 8) | Hecho | `test/resumen.test.ts` y `test/auth.test.ts` (resumen, decisiones y aislamiento por usuario) más 90 comprobaciones en Chrome (orden del lateral, pie fijo, ruta por hash y botón atrás, columnas, orden, búsqueda y filtro, detalle con pestañas, «Abrir en el asistente» sin enviar nada, esqueleto, vacío, error con reintento, 390 px apilado, claro y oscuro, axe sin violaciones). Ver supuesto 29. |
| Estado consistente, conversación restaurada y lateral compacto (Paso 8.1) | Hecho | `test/resumen.test.ts` (bandeja, resumen y detalle coinciden antes y después de procesar y decidir), `test/auth.test.ts` (la sesión de otro usuario responde 404) y 47 comprobaciones en Chrome (mismo estado en bandeja y tabla, restauración de la conversación más reciente, saludo si no hay, filtro del historial y su forma de quitarlo, «Sesión nueva» con el caso en foco, aislamiento entre usuarios, reparto al 50% con scroll propio, ítems de dos líneas, 390 px, claro y oscuro, axe). Ver supuesto 30. |
| Botones de navegación y reporte en vista propia (Paso 8.3) | Hecho | 104 comprobaciones en Chrome (botones iguales con ícono, chevron, hover, foco y `aria-current`; `#/reporte` directo y con recarga; «Volver al asistente» y el título con la conversación intacta; esqueleto, error con reintento y refresco con el estado compartido; 390 px; claro y oscuro; axe sin violaciones). Sin cambios de servidor. Ver supuesto 31. |
| **Bonus `modulo/`** (§9.4) | Hecho | Generado por `bun run build:modulo` desde las mismas fuentes que usa la app (una sola fuente de verdad). `test/modulo.test.ts`: alineación exacta (falla si se desalinea o se retoca a mano), frontmatter del PRD, imports permitidos y funcionamiento sin servidor en una carpeta aislada. Limitación: solo almacenamiento local, y la confirmación del envío depende del prompt y de la plataforma anfitriona (supuesto 21). **No probado dentro de una plataforma de agentes real**, solo importado desde un anfitrión mínimo. |
| Experiencia ampliada de Sofía (Paso 5) | **Hecha, con límites** | Ver la tabla siguiente. |

### Experiencia de Sofía (Paso 5)

Las pruebas son `test/panel.test.ts` y `test/contraste.test.ts`, más una auditoría con Chrome real (Puppeteer) y axe-core sobre el front, con el modelo real en el chat.

| Prioridad | Estado | Qué se hizo y qué no |
|---|---|---|
| 1. Datos bancarios enmascarados en el chat | Hecho | El número de cuenta sale como `•••• 2345` en la respuesta del modelo (aunque la escriba con espacios o guiones), en el mensaje del usuario, en la sesión guardada, en la API y en el panel; completo solo en el formulario. Probado con el modelo real: pidiéndole la cuenta «completa», responde enmascarada. Límite: solo se enmascara el número de cuenta (supuesto 23). |
| 2. Bandeja con estados | Hecho | Los cuatro estados, calculados con la fecha elegida (supuesto 22). |
| 3. Panel con trazabilidad y soportes | Hecho | En el detalle (lateral derecho plegable), cada campo se despliega con: de dónde sale en el maestro, qué herramienta lo llenó y cuándo, dónde quedó en el formulario, qué tan seguro es y, si aplica, la razón y la regla. Los soportes llevan semáforo con ícono **y** texto (no solo color). Detalle técnico (nombre de la herramienta) en un desplegable aparte. |
| 4. Confirmaciones una por una | Hecho | Una tarjeta por valor («valor 1 de 2») **en el chat, fija sobre el campo de texto**, con el valor, la razón y la regla (plegada en pantallas angostas); se confirma o se deja «para revisar con el cliente» (supuesto 24). La confirmación del envío sigue siendo el botón del chat. Límite: no se puede corregir un valor. |
| 5. Selector visible de fecha | Hecho | Fecha, «Fecha del reto» y «Hoy». Recalcula bandeja, caso, reporte y la fecha que usa el chat; avisa cuando el paquete se armó con otra fecha. Se recuerda entre visitas. |
| 6. Reporte entre casos y costo por caso | Hecho, con límites | Faltantes agrupados por campo, pendientes por caso y costo (tokens y dólares, siempre rotulado como estimado; supuesto 25). Límite: el costo solo cubre las conversaciones con el modelo; en Supabase se guarda como un archivo por caso (lectura y escritura no atómicas, suficiente a esta escala). |
| 7. Accesibilidad | Hecho, con límites | Verificado: navegación completa con teclado (enlace «Saltar», Tab, flechas en la bandeja, Enter y Espacio en los campos, foco movido al título al abrir un caso o decidir), foco visible de 3 px, contraste AA **calculado** sobre los colores reales en tema claro y oscuro (32 pares de texto y 9 de bordes, foco y semáforo por tema), reducción de movimiento (sin animaciones ni transiciones), axe-core sin violaciones WCAG A y AA en seis estados (inicio, caso con un campo abierto, tarjeta de decisión, reporte, tema oscuro y móvil), y anuncios para lectores de pantalla en regiones vivas. **No se probó con un lector de pantalla real** (VoiceOver o NVDA) ni se hizo una auditoría manual completa. |
| Reglas de diseño | Hecho | Íconos solo de Lucide; sin etiquetas tipo pastilla sobre los títulos (el estado va como texto con ícono); animaciones sutiles de 160 a 200 ms; lenguaje de la analista: los soportes, las herramientas y los países se muestran por su nombre, no por su código. |

**Dejado fuera a propósito:** corregir o editar un valor desde el panel; un selector manual de tema claro u oscuro (sigue el del sistema); filtros de campos; notificaciones.

**Dependencia a tener en cuenta:** los íconos de Lucide se cargan desde un CDN (versión fija). Sin red, la página funciona pero sin íconos; todo lleva también texto.

**Qué falta para producción:** autenticación y roles (hoy el enlace es público y solo lo protegen los topes); un dueño del dato del maestro; la integración real con correo y firma electrónica (fuera de alcance); revisión de privacidad de lo guardado en Supabase; pruebas con plantillas reales y peores que los fixtures; monitoreo y alertas del gasto.

## 9. Uso de IA

**Autoría y criterio**

Problema, alcance, trampas, supuestos y plan definidos con criterio de Diego Gallón; cada decisión de negocio fue aprobada por Diego.

**Qué se descartó o se corrigió de lo propuesto, y por qué**

- Desplegar en Railway o Render: el plan lo mencionaba y se descartó a favor de Vercel; por eso la persistencia pasó a Supabase.
- `gemini-2.5-flash` y `deepseek-chat`: se dejaron de usar al comprobar con una llamada real que no están disponibles en estas cuentas.
- Evitar que el modelo cuente mal los campos llenos solo con el prompt: no bastó (gpt-4.1-mini sumaba el RUC por confirmar a los llenos); se resolvió haciendo que la herramienta devuelva los conteos ya calculados.
- Dejar que el modelo vea y pase el argumento `confirmado`: se quitó del esquema que ve y se ignora en el servidor.
- Borrar desde el entorno de desarrollo los datos de prueba del proyecto de Supabase: el sistema de permisos lo denegó; quedó como tarea manual de Diego (`POST /api/reset`).

**Verificación humana.** Diego revisó y aprobó cada paso antes de continuar. El autor debe poder explicar cada línea entregada.

## 10. Riesgos de llevar esto a producción y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El modelo «completa» un valor plausible, o cuenta mal | Los valores salen solo de herramientas y los conteos vienen precalculados. Las verificaciones de `scripts/e2e-llm.ts` comprueban el contenido de las respuestas. **El texto libre del modelo no se verifica campo a campo**; mitigación futura: validar cada valor citado contra el mapeo antes de mostrarlo. |
| Inyección de instrucciones en el correo del cliente | El cuerpo llega como dato (`cuerpo_cliente_no_confiable`) y el prompt lo prohíbe como instrucción. Lo decisivo: ninguna acción externa depende del modelo (confirmación en servidor), y hay una prueba con un correo malicioso. |
| Proveedores inestables o lentos | Cadena con failover (§4). Medido: Gemini tuvo timeouts y 503 en horas de alta demanda. Mitigaciones: orden de la cadena, modo sin modelo, tope de tiempo y alerta si la mediana de latencia sube. |
| Límite de la función en Vercel (60 s) frente a un turno de 4 llamadas | Con timeouts de 25 s por llamada, dos proveedores lentos seguidos podrían exceder la función. Mitigación: bajar `LLM_TIMEOUT_MS`, sacar el proveedor lento de la cadena, o pasar a streaming/proceso persistente. |
| Gasto descontrolado en un enlace público | Topes por sesión, por IP y global diario, con paso a modo sin modelo. Limitación: la IP sale de `x-forwarded-for`, confiable detrás de Vercel pero falsificable en otros despliegues. |
| Datos sensibles (cuenta bancaria, NIT) en Supabase y en el chat | Bucket privado, RLS activo y clave `service_role` solo en el servidor; los logs no guardan valores. Falta: enmascarar en el chat (Paso 5), cifrado y política de retención. |
| Credencial única (`service_role`) de Supabase | Rotación periódica, mínimo de personas con acceso y, a futuro, roles de base de datos de menor alcance. |
| Maestro desactualizado | Asignar un dueño del dato y una fecha de última revisión visible en el paquete. |
| Portales con CAPTCHA o MFA | El humano opera el portal; el agente prepara los valores (§5). |
| Soportes con vigencia que cambia con la fecha | `FECHA_REFERENCIA` explícita y visible en cada resumen y en el checklist; alertas a 30 y 15 días. |
| En el módulo la confirmación del envío no la impone un servidor | Depende del prompt y de que la plataforma anfitriona controle `confirmado`. Antes de usar el módulo con acciones reales, que el anfitrión exija el botón o el «envía» como lo hace la aplicación; no confiar solo en el modelo. |
| El formulario descargable lleva la cuenta completa | **Mitigado.** Con `AUTH=on`, `/api/paquetes/*` exige token, y cada usuario solo descarga los archivos de su propio espacio (`usuarios/<id>/`); sin token, 401, y con el token de otro usuario, 404 (con pruebas). Sigue siendo cierto que el enmascarado protege el chat y no los archivos, y que no hay roles ni política de retención. |
| Auditoría fina por usuario y roles | Hay login y los logs guardan el usuario, pero no hay roles ni se distingue quién confirma cada envío en la constancia. Añadirlo antes de conectar correo o firma real. |
| Verificación de token con 60 s de caché | Un token revocado puede seguir valiendo hasta 60 s. Aceptable aquí; para más rigor, bajar el TTL o validar la firma del JWT localmente. |
| Credenciales compartidas con quien evalúa | Contraseñas por canal aparte (correo), no en el repositorio; cambiarlas al terminar la evaluación. |
