# Transcripción: Corp Andina de punta a punta (deepseek-deepseek-flash)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `proveedor_leer_solicitud` {"caso":"ec-corp-andina"} → ok: formato PDF, 15 campos, 5 soportes pedidos
- `proveedor_mapear_campos` {"caso":"ec-corp-andina"} → ok: 13 llenos, 1 por confirmar, 1 faltantes
- `proveedor_generar_formulario` {"caso":"ec-corp-andina"} → ok: formulario PDF generado
- `proveedor_armar_paquete` {"caso":"ec-corp-andina"} → ok: paquete armado, todavía no está listo para firma

## Asistente (modelo, deepseek/deepseek-flash, 7.4 s)

Caso **ec-corp-andina** procesado (Corporación Andina de Servicios S.A., Ecuador, formulario en PDF).

- **Llenos:** 13 campos, con datos del repositorio maestro (empresa, domicilio, ciudad, país, teléfono, correo, web, representante legal y cargo, actividad económica, banco, cuenta y SWIFT).
- **Por confirmar:**
  - **RUC:** se llenó con el NIT colombiano 900123456; es un identificador extranjero y el cliente puede aceptarlo o pedir un registro local.
- **Faltantes:** «Número de contribuyente especial» (campo opcional que no existe en el maestro). No bloquea la firma, pero queda en el checklist.
- **¿Listo para firma?** **No.** El paquete está bloqueado porque falta el **certificado de cumplimiento tributario**.
- **Soportes a actualizar:**
  - **Certificado de cumplimiento tributario: ausente** (bloqueador) — hay que conseguirlo.
  - **Cámara de Comercio:** vigente pero **alerta amarilla**, vence el **2026-09-30** (27 días desde la fecha de referencia 2026-09-03); conviene renovarlo antes de la firma.
  - Además, los cuatro soportes existentes (Cámara de Comercio, RUT, certificación bancaria y estados financieros) fueron emitidos en Colombia mientras el cliente es de Ecuador: se incluyen con advertencia, no bloquean.
- **Dónde quedó:** el formulario y el paquete quedaron en la carpeta del caso y se descargan desde el panel del caso.

No envié nada; cuando quieras lo preparamos para el envío (y no olvides confirmar el RUC antes de la firma).

⚠ El caso ec-corp-andina NO está completo. Si confirmas, el envío simulado quedará marcado como INCOMPLETO.
Pendientes que bloquean la firma: Falta el soporte «certificado de cumplimiento tributario».
Campos faltantes: Número de contribuyente especial.
¿Quieres enviarlo así de todas formas?
Para continuar escribe «envía» o pulsa el botón. Cualquier otro mensaje cancela la confirmación.

needsConfirmation: true

## Usuario

envía

- `proveedor_simular_envio` {"caso":"ec-corp-andina"} → ok: envío simulado marcado como incompleto

## Asistente (modelo, 0.0 s)

Listo: dejé el envío simulado en la carpeta del caso.
Quedó marcado como INCOMPLETO por lo pendiente que te indiqué.
No se envió nada real: queda en manos de una persona.

needsConfirmation: false

---
Todas las verificaciones pasaron.
