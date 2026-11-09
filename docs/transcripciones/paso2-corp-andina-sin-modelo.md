# Transcripción: Corp Andina de punta a punta (sin-modelo)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `processCaso` {"caso":"ec-corp-andina"} → ok: 15 campos, firma: bloqueado

## Asistente (sin_modelo, 0.0 s)

> Aviso: No hay ningún modelo configurado: trabajo en modo sin modelo.

Caso ec-corp-andina (pdf), soportes evaluados al 2026-09-03.
Campos: 15. Llenos: 13.
Por confirmar: RUC.
Faltantes (no bloquean la firma): Número de contribuyente especial.
No, el paquete todavía no está listo para firma.
Qué lo bloquea: Soporte ausente: certificado_cumplimiento_tributario.
Alertas de vigencia: camara_comercio: vigente, vence el 2026-09-30 (quedan 27 días) [amarilla].
Advertencias: camara_comercio: emitido en CO; el cliente es de EC; rut: emitido en CO; el cliente es de EC; certificacion_bancaria: emitido en CO; el cliente es de EC; estados_financieros: emitido en CO; el cliente es de EC.
Los archivos quedaron en out/ec-corp-andina/.

⚠ El caso ec-corp-andina NO está completo. Si confirmas, el envío simulado quedará marcado como INCOMPLETO.
Pendientes que bloquean la firma: Soporte ausente: certificado_cumplimiento_tributario.
Campos faltantes: Número de contribuyente especial.
¿Quieres enviarlo así de todas formas?
Para continuar escribe «envía» o pulsa el botón. Cualquier otro mensaje cancela la confirmación.

needsConfirmation: true

## Usuario

envía

- `proveedor_simular_envio` {"caso":"ec-corp-andina"} → ok: INCOMPLETO → out/ec-corp-andina/ENVIO-SIMULADO.md

## Asistente (sin_modelo, 0.0 s)

Listo: dejé el envío simulado en out/ec-corp-andina/ENVIO-SIMULADO.md.
Quedó marcado como INCOMPLETO por lo pendiente que te indiqué.
No se envió nada real: queda en manos de una persona.

needsConfirmation: false

---
Todas las verificaciones pasaron.
