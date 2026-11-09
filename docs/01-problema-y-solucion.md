# Reto 01 · Registro como Proveedor — Problema y solución

> Documento de trabajo. Base del `SOLUCION.md` final. Fuente: `PRD.md` v2.0 y fixtures de `reto-01`.

## 1. El problema en una frase

Cada vez que un cliente quiere pagarle a Periferia, alguien del área administrativa transcribe a mano los mismos datos y busca los mismos soportes para llenar el formato del cliente; tras la salida de una persona, ese trabajo se volvió lento, riesgoso y depende de quien sepa dónde está todo.

**A quién le duele**
- **Analista administrativa (Sofía):** transcribe campo por campo, busca soportes, arma el correo.
- **Periferia (negocio):** mientras no está registrada como proveedor, no puede facturar. El retraso pega en el flujo de caja.
- **Representante legal:** firma lo que le llega; si hay un error en cuenta o NIT, firma un error.

**Por qué duele**
1. **Error en datos sensibles:** cuenta bancaria, NIT. Un dígito mal puesto tiene costo real.
2. **Conocimiento en una sola cabeza:** qué pide cada país, dónde está cada soporte, cuál está vencido.
3. **Tiempo hasta facturar:** días de cola por cada registro (8–12 al mes).

## 2. Qué NO es el problema

- No es navegar portales de clientes (fuera de alcance; solo se diseña).
- No es firmar ni enviar (decisión humana).
- No es leer correos reales: recepción deja cada solicitud como un caso en una carpeta.

## 3. Lo que realmente se evalúa

**Confianza, no automatización.** El agente debe:
- Nunca inventar un valor. Campo sin fuente = `faltante`.
- Marcar lo dudoso como `requiere_confirmacion`, no resolverlo solo.
- Bloquear la firma si un soporte está vencido o ausente.
- Pedir confirmación explícita antes de cualquier acción externa.
- Dejar rastro de todo (`log.jsonl`) y trazabilidad de cada valor (ruta en el maestro).

Principio de diseño: **el código decide, el modelo conversa.** Todo lo que toca un dato es determinista y verificable sin modelo (`demo.ts`). El modelo solo entiende la petición, elige herramientas y explica resultados.

## 4. Hallazgos en los fixtures (trampas)

| # | Hallazgo | Impacto | Decisión |
|---|---|---|---|
| H1 | La vigencia depende de la fecha. Cámara de Comercio vence 2026-09-30; parafiscales vencieron 2026-08-31. Con la fecha real de hoy (nov-2026) **todo** paquete queda bloqueado por Cámara vencida. | Resultado no determinista. | `fecha_referencia` como argumento/variable (`FECHA_REFERENCIA`, default `2026-09-03`, la fecha del PRD). Se muestra siempre en el resumen. |
| H2 | Ecuador exige `certificado_cumplimiento_tributario`, que **no existe** en el repositorio. | Soporte ausente → bloquea firma. | Checklist lo marca `ausente`; `listo_para_firma = false`. |
| H3 | Honduras exige `parafiscales`, vencido el 2026-08-31. | Soporte vencido → bloquea firma. | Checklist lo marca `vencido`. |
| H4 | RUC (EC, PA) y RTN (HN) mapean en el glosario a `nit`, pero Periferia solo tiene NIT colombiano. | Riesgo de afirmar algo falso. | Se llena con el NIT y queda `requiere_confirmacion` con nota "identificador extranjero" (RN1). |
| H5 | Campos sin fuente: "Número de contribuyente especial" (EC), "Referencias comerciales" (HN). | Tentación de inventar. | `faltante`. Aparecen en el checklist, no bloquean (RN3). |
| H6 | "Ingresos anuales" (HN) apunta a `ingresos_ultimo_ano.valor` = 98.000.000.000, pero la moneda es COP y el cliente es hondureño. | Cifra sin moneda engaña. | Se llena con el valor y la moneda ("98.000.000.000 COP (2025)") y se marca `requiere_confirmacion`. *(Decisión nuestra, documentada como supuesto.)* |
| H7 | "País" mapea a `pais` = "CO" (código). | Formato poco legible en un formulario. | Mostrar "Colombia" desde un diccionario de países. *(Supuesto documentado.)* |
| H8 | Honduras pide "registro tributario **de su país**"; el RUT es colombiano. | Soporte presente pero de otro país emisor. | Se incluye, con nota en el checklist "emitido en CO". *(Supuesto documentado.)* |
| H9 | Panamá es `portal`: no hay plantilla de archivo y las credenciales llegaron al representante legal. | Formato no soportado. | Responder "formato no soportado" y generar `valores-portal.md` con los valores listos para copiar. Credenciales y "Enviar" son humanos. |
| H10 | Industrias Delta (CO) pide datos bancarios explícitamente. | RN2. | Se llenan en el formulario; **nunca** en `borrador-correo.md`. |

### Resultado esperado por caso (con `FECHA_REFERENCIA = 2026-09-03`)

| Caso | Formato | Campos | Por confirmar | Faltantes | Soportes | Listo para firma |
|---|---|---|---|---|---|---|
| `co-industrias-delta` | xlsx | 17 | 0 | 0 | 4/4 vigentes | **Sí** |
| `ec-corp-andina` | pdf | 15 | RUC | Contribuyente especial | Falta cumplimiento tributario | **No** |
| `hn-agroexport-sula` | xlsx | 11 | RTN, Ingresos anuales | Referencias comerciales | Parafiscales vencido | **No** |
| `pa-logistica-istmo` | portal | 9 | RUC | — | 2/2 vigentes | No aplica: `valores-portal.md` |

> Estos números salen de leer los fixtures a mano. El `demo.ts` debe confirmarlos; si difieren, gana el código y se corrige esta tabla.

## 5. La solución en texto

### 5.1 Recorrido de Sofía
1. Recepción deja el caso en la carpeta de entrada.
2. Sofía escribe en el chat: "Procesa el caso ec-corp-andina. No envíes nada todavía."
3. El agente lee la solicitud: país, cliente, formato, campos y soportes exigidos.
4. Mapea cada campo contra el maestro: `lleno` (con ruta), `faltante` o `requiere_confirmacion`.
5. Genera el formulario en el formato del cliente (xlsx / pdf / valores para portal).
6. Arma el paquete: formulario, soportes, `checklist.md`, `borrador-correo.md`.
7. Resume en el chat y termina con una pregunta explícita. El chat la resalta.
8. Sofía confirma → el agente escribe `ENVIO-SIMULADO.md`. Nada más.
9. Fuera del sistema: firma del representante legal y envío al cliente.

### 5.2 Componentes
- **Herramientas** (`src/tools/proveedor.ts`): las 5 del contrato, deterministas, con `zod`, devuelven `{ ok, data }` o `{ ok: false, error }` y nunca lanzan.
- **Mapeo en capas:** (1) etiqueta exacta del glosario → confianza 1.0; (2) etiqueta normalizada (sin tildes, minúsculas, espacios) → 0.9; (3) sin coincidencia → `faltante`. Reglas de país y de moneda bajan a `requiere_confirmacion`. Umbral 0.8.
- **Ciclo del agente:** bucle modelo → herramientas con tope de 25 iteraciones, validación `zod` antes de ejecutar, bandera `needsConfirmation`, tope de tokens por sesión.
- **Adaptador LLM:** interfaz `enviar(mensajes, herramientas)` + una implementación. Modelo rápido y barato: el trabajo pesado es determinista.
- **Separación:** comportamiento en `agent/prompt.md`, conocimiento en `src/knowledge/registro-proveedor.md`, ejecución en `src/tools/`.
- **Front:** chat con historial, tarjetas de tool calls y confirmación resaltada + panel lateral del caso (plus).
- **Salidas:** `out/` en local; en Vercel, `OUT_DIR=/tmp/out` (Vercel solo permite escribir en `/tmp`).

### 5.3 Extras (para descrestar, en orden)
1. **Módulo reutilizable** (`modulo/`): +10 puntos. Mismas piezas, no copias.
2. **Panel del caso con trazabilidad:** cada campo con estado y origen (clic → ruta del maestro y herramienta que lo llenó); soportes en verde / amarillo / rojo.
3. **Reporte de faltantes entre casos:** qué datos piden varios clientes y el maestro no tiene → recomendación al dueño del dato.
4. **Costo visible:** tokens y costo estimado por caso en la interfaz; plan de medición de impacto en `SOLUCION.md` (sin cifras inventadas).

## 6. Decisiones abiertas (Diego)
- Proveedor y modelo del LLM (depende de qué clave tengas).
- Front: HTML plano o React.
- Nombre del repo en GitHub.
