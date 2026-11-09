# Transcripción: Corp Andina de punta a punta (deepseek-deepseek-flash)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `proveedor_leer_solicitud` {"caso":"ec-corp-andina"} → ok: formato pdf, 15 campos, 5 soportes exigidos
- `proveedor_mapear_campos` {"caso":"ec-corp-andina"} → ok: 13 llenos, 1 por confirmar, 1 faltantes
- `proveedor_generar_formulario` {"caso":"ec-corp-andina"} → ok: pdf → out/ec-corp-andina/formulario.pdf
- `proveedor_armar_paquete` {"caso":"ec-corp-andina"} → ok: paquete bloqueado → out/ec-corp-andina/paquete/

## Asistente (modelo, deepseek/deepseek-flash, 10.0 s)

**Caso ec-corp-andina** — Corporación Andina de Servicios S.A. (Ecuador), formulario PDF. Formulario generado en `out/ec-corp-andina/formulario.pdf`.

**Llenos: 13 campos** (de 15 del total), con fuente en el maestro: nombre/razón social, domicilio fiscal, ciudad, país, teléfono, correo, página web, representante legal, cargo, actividad económica, banco, número de cuenta y SWIFT. Los datos bancarios se cargaron porque la plantilla los exige (no los repito aquí; están en el formulario).

**Por confirmar: 1**
- **RUC:** se usó el NIT colombiano (900123456) como RUC — identificador extranjero, confianza 0.7. Requiere tu confirmación.

**Faltantes: 1** (no bloquea la firma)
- **Número de contribuyente especial:** no existe en el glosario ni en el maestro. Campo opcional.

**¿Listo para firma? No** — paquete bloqueado. Bloqueador: falta el **certificado de cumplimiento tributario** (soporte exigido, ausente).

**Soportes a actualizar / vigilar** (referencia: 2026-09-03):
- **Certificado de cumplimiento tributario:** ausente → hay que conseguirlo.
- **Cámara de comercio:** vigente pero **alerta amarilla**, vence el 2026-09-30 (quedan 27 días).
- RUT, certificación bancaria y estados financieros: vigentes sin alerta de vigencia.
- Advertencia (no bloquea): los cuatro soportes existentes fueron emitidos en Colombia y el cliente es de Ecuador.

**Dónde quedó:** `out/ec-corp-andina/paquete/` (formulario, copias de soportes, `checklist.md` y `borrador-correo.md`).

No se envió nada. Cuando quieras avanzar, confírmame si el RUC se deja con el NIT y, una vez tengamos el certificado de cumplimiento tributario, el paquete quedaría listo para firma.

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
