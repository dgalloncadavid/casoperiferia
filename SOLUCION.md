# SOLUCION.md — Reto 1 «Registro como proveedor»

> Estado: **Pasos 1 a 5 entregados** (incluido el bonus `modulo/` y la experiencia de Sofía). Pendiente: el enlace público, que despliega Diego desde la conexión de Vercel (ver §8).

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

**Almacenamiento.** Una interfaz `Storage` con dos implementaciones, elegidas con `STORAGE`:

- `local` (disco, `out/`): lo usan `demo.ts` y el desarrollo. Con `VERCEL` definido y sin `OUT_DIR`, escribe solo en `/tmp`.
- `supabase`: tablas `sessions` y `logs` (más `usage` y `rate_limits` de la migración 002) y el bucket privado `paquetes`. Producción en Vercel no depende del disco.

Las herramientas escriben todo a través de `Storage`; ni siquiera releer el xlsx para verificarlo toca el disco directamente.

**Panel de la analista (Paso 5).** Además del chat, el front tiene una **bandeja de casos** (nuevo, necesita tu decisión, listo para firma, enviado), un **panel del caso** (confirmaciones una por una, soportes con semáforo y trazabilidad de cada campo), un **selector de fecha de referencia** y un **reporte** de faltantes y costo entre casos. Es HTML, CSS y JavaScript sin paso de build (`web/`), y lo alimentan endpoints que calculan todo **en vivo y sin modelo** con la fecha elegida (`GET /api/casos`, `/api/casos/:caso`, `/api/reporte`; `POST /api/casos/:caso/procesar`, `/decisiones` y `/proponer-envio`). Procesar desde el panel usa las mismas herramientas en orden (`processCaso`) y **no gasta tokens**.

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
23. **Solo el número de cuenta se enmascara** (`•••• 2345`) en el chat, en lo que se guarda de la sesión y en el panel. El banco, el tipo de cuenta, el titular y el SWIFT se muestran. El número completo va únicamente en el formulario (y en `valores-portal.md`, que es el formulario del portal) y esos archivos se descargan sin autenticación (ver §10).
24. **Confirmar o «revisar con el cliente» un valor se guarda para la trazabilidad y para el estado de la bandeja, pero no cambia el formulario ya generado** ni permite escribir otro valor: ningún valor del formulario sale de una persona ni del modelo, solo del maestro.
25. **El costo por caso reparte el gasto de cada turno con modelo, por igual, entre los casos que ese turno tocó.** Un turno que no toca ningún caso solo cuenta en el gasto global. Es una estimación con la tabla de precios configurada (supuesto 12). Procesar desde el panel y el modo sin modelo cuestan cero.

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
| **Enlace público** | **No hecho aún** | Lo despliega Diego desde la conexión de Vercel. `vercel build` no se pudo ejecutar localmente (exige un proyecto real enlazado). Comprobado: la función empaqueta para Node y responde `health`, `chat` y la descarga. `vercel.json` y `api/index.ts` no se han probado en el despliegue real. |
| **Bonus `modulo/`** (§9.4) | Hecho | Generado por `bun run build:modulo` desde las mismas fuentes que usa la app (una sola fuente de verdad). `test/modulo.test.ts`: alineación exacta (falla si se desalinea o se retoca a mano), frontmatter del PRD, imports permitidos y funcionamiento sin servidor en una carpeta aislada. Limitación: solo almacenamiento local, y la confirmación del envío depende del prompt y de la plataforma anfitriona (supuesto 21). **No probado dentro de una plataforma de agentes real**, solo importado desde un anfitrión mínimo. |
| Experiencia ampliada de Sofía (Paso 5) | **Hecha, con límites** | Ver la tabla siguiente. |

### Experiencia de Sofía (Paso 5)

Las pruebas son `test/panel.test.ts` y `test/contraste.test.ts`, más una auditoría con Chrome real (Puppeteer) y axe-core sobre el front, con el modelo real en el chat.

| Prioridad | Estado | Qué se hizo y qué no |
|---|---|---|
| 1. Datos bancarios enmascarados en el chat | Hecho | El número de cuenta sale como `•••• 2345` en la respuesta del modelo (aunque la escriba con espacios o guiones), en el mensaje del usuario, en la sesión guardada, en la API y en el panel; completo solo en el formulario. Probado con el modelo real: pidiéndole la cuenta «completa», responde enmascarada. Límite: solo se enmascara el número de cuenta (supuesto 23). |
| 2. Bandeja con estados | Hecho | Los cuatro estados, calculados con la fecha elegida (supuesto 22). |
| 3. Panel con trazabilidad y soportes | Hecho | Cada campo se despliega con: de dónde sale en el maestro, qué herramienta lo llenó y cuándo, dónde quedó en el formulario, qué tan seguro es y, si aplica, la razón y la regla. Los soportes llevan semáforo con ícono **y** texto (no solo color). Detalle técnico (nombre de la herramienta) en un desplegable aparte. |
| 4. Confirmaciones una por una | Hecho | Una tarjeta por valor («valor 1 de 2») con el valor, la razón y la regla; se confirma o se deja «para revisar con el cliente» (supuesto 24). La confirmación del envío sigue siendo el botón del chat. Límite: no se puede corregir un valor. |
| 5. Selector visible de fecha | Hecho | Fecha, «Fecha del reto» y «Hoy». Recalcula bandeja, caso, reporte y la fecha que usa el chat; avisa cuando el paquete se armó con otra fecha. Se recuerda entre visitas. |
| 6. Reporte entre casos y costo por caso | Hecho, con límites | Faltantes agrupados por campo, pendientes por caso y costo (tokens y dólares, siempre rotulado como estimado; supuesto 25). Límite: el costo solo cubre las conversaciones con el modelo; en Supabase se guarda como un archivo por caso (lectura y escritura no atómicas, suficiente a esta escala). |
| 7. Accesibilidad | Hecho, con límites | Verificado: navegación completa con teclado (enlace «Saltar», Tab, flechas en la bandeja, Enter y Espacio en los campos, foco movido al título al abrir un caso o decidir), foco visible de 3 px, contraste AA **calculado** sobre los colores reales en tema claro y oscuro (32 pares de texto y 9 de bordes, foco y semáforo por tema), reducción de movimiento (sin animaciones ni transiciones), axe-core sin violaciones WCAG A y AA en seis estados (inicio, caso con un campo abierto, tarjeta de decisión, reporte, tema oscuro y móvil), y anuncios para lectores de pantalla en regiones vivas. **No se probó con un lector de pantalla real** (VoiceOver o NVDA) ni se hizo una auditoría manual completa. |
| Reglas de diseño | Hecho | Íconos solo de Lucide; sin etiquetas tipo pastilla sobre los títulos (el estado va como texto con ícono); animaciones sutiles de 160 a 200 ms; lenguaje de la analista: los soportes, las herramientas y los países se muestran por su nombre, no por su código. |

**Dejado fuera a propósito:** corregir o editar un valor desde el panel; un selector manual de tema claro u oscuro (sigue el del sistema); filtros de campos; notificaciones.

**Dependencia a tener en cuenta:** los íconos de Lucide se cargan desde un CDN (versión fija). Sin red, la página funciona pero sin íconos; todo lleva también texto.

**Qué falta para producción:** autenticación y roles (hoy el enlace es público y solo lo protegen los topes); un dueño del dato del maestro; la integración real con correo y firma electrónica (fuera de alcance); revisión de privacidad de lo guardado en Supabase; pruebas con plantillas reales y peores que los fixtures; monitoreo y alertas del gasto.

## 9. Uso de IA

**Asistentes usados para construir**

Problema, alcance, trampas, supuestos y plan definidos con criterio de Diego Gallón, apoyado en asistentes de IA para análisis y revisión. Claude Code escribió el código bajo esa dirección; cada decisión de negocio fue aprobada por Diego.

**Qué se descartó o se corrigió de lo propuesto, y por qué**

- Desplegar en Railway o Render: el plan lo mencionaba y se descartó a favor de Vercel; por eso la persistencia pasó a Supabase.
- `gemini-2.5-flash` y `deepseek-chat`: se dejaron de usar al comprobar con una llamada real que no están disponibles en estas cuentas.
- Evitar que el modelo cuente mal los campos llenos solo con el prompt: no bastó (gpt-4.1-mini sumaba el RUC por confirmar a los llenos); se resolvió haciendo que la herramienta devuelva los conteos ya calculados.
- Dejar que el modelo vea y pase el argumento `confirmado`: se quitó del esquema que ve y se ignora en el servidor.
- Borrar desde el asistente los datos de prueba del proyecto de Supabase: el sistema de permisos lo denegó; quedó como tarea manual de Diego (`POST /api/reset`).

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
| Las descargas del paquete no están autenticadas y el formulario lleva la cuenta completa | Con datos ficticios no hay impacto. En producción, autenticar las descargas (y todo el panel), enlaces temporales firmados y política de retención. El enmascarado protege el chat, no los archivos. |
| Sin autenticación ni auditoría por usuario | Añadir login y registrar quién confirma cada envío antes de conectar correo o firma real. |
