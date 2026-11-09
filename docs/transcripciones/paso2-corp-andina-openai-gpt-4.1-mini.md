# Transcripción: Corp Andina de punta a punta (openai-gpt-4.1-mini)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `proveedor_leer_solicitud` {"caso":"ec-corp-andina"} → ok: formato pdf, 15 campos, 5 soportes exigidos
- `proveedor_mapear_campos` {"caso":"ec-corp-andina"} → ok: 13 llenos, 1 por confirmar, 1 faltantes
- `proveedor_generar_formulario` {"caso":"ec-corp-andina"} → ok: pdf → out/ec-corp-andina/formulario.pdf
- `proveedor_armar_paquete` {"caso":"ec-corp-andina"} → ok: paquete bloqueado → out/ec-corp-andina/paquete/

## Asistente (modelo, openai/gpt-4.1-mini, 6.0 s)

Caso "ec-corp-andina":

- Llenos: 13 campos llenados con datos del maestro, incluyendo nombre empresa, domicilio fiscal, ciudad, país, teléfono, correo, página web, representante legal, cargo, actividad económica, banco, número de cuenta y SWIFT.
- Por confirmar: 1 campo, RUC, con nota que indica uso del NIT colombiano como identificador extranjero.
- Faltantes: 1 campo sin dato, Número de contribuyente especial (no bloquea la firma).
- Soportes a actualizar: Falta el certificado de cumplimiento tributario (ausente, bloquea la firma). La cámara de comercio está vigente pero con alerta amarilla (vence en 27 días, referencia 2026-09-03). Otros soportes están vigentes aunque emitidos en Colombia, no en Ecuador (cliente).
- ¿Listo para firma? No, por falta del certificado de cumplimiento tributario.
- Ruta del paquete: out/ec-corp-andina/

⚠ El caso ec-corp-andina NO está completo. Si confirmas, el envío simulado quedará marcado como INCOMPLETO.
Pendientes que bloquean la firma: Soporte ausente: certificado_cumplimiento_tributario.
Campos faltantes: Número de contribuyente especial.
¿Quieres enviarlo así de todas formas?
Para continuar escribe «envía» o pulsa el botón. Cualquier otro mensaje cancela la confirmación.

needsConfirmation: true

## Usuario

envía

- `proveedor_simular_envio` {"caso":"ec-corp-andina"} → ok: INCOMPLETO → out/ec-corp-andina/ENVIO-SIMULADO.md

## Asistente (modelo, 0.0 s)

Listo: dejé el envío simulado en out/ec-corp-andina/ENVIO-SIMULADO.md.
Quedó marcado como INCOMPLETO por lo pendiente que te indiqué.
No se envió nada real: queda en manos de una persona.

needsConfirmation: false

---
Todas las verificaciones pasaron.
