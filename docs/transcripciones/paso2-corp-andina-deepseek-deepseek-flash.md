# Transcripción: Corp Andina de punta a punta (deepseek-deepseek-flash)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `proveedor_leer_solicitud` {"caso":"ec-corp-andina"} → ok: formato pdf, 15 campos, 5 soportes exigidos
- `proveedor_mapear_campos` {"caso":"ec-corp-andina"} → ok: 13 llenos, 1 por confirmar, 1 faltantes
- `proveedor_generar_formulario` {"caso":"ec-corp-andina"} → ok: pdf → out/ec-corp-andina/formulario.pdf
- `proveedor_armar_paquete` {"caso":"ec-corp-andina"} → ok: paquete bloqueado → out/ec-corp-andina/paquete/

## Asistente (modelo, deepseek/deepseek-flash, 7.3 s)

**Caso `ec-corp-andina`** — Corporación Andina de Servicios S.A. (Ecuador), formato PDF.

**Llenos:** 13 campos (de 15), todos con fuente en el maestro: nombre, domicilio fiscal, ciudad, país, teléfono, correo, web, representante legal, cargo, actividad económica, banco, número de cuenta y SWIFT.

**Por confirmar:** 1
- RUC: se usó el NIT colombiano 900123456 como identificador extranjero (confianza 0.7).

**Faltantes:** 1
- Número de contribuyente especial: no existe en el maestro. No bloquea la firma.

**¿Listo para firma? No.** Estado bloqueado por soporte ausente: `certificado_cumplimiento_tributario`.

**Soportes a actualizar:**
- **Certificado de cumplimiento tributario: ausente** — es el bloqueador; hay que conseguirlo y anexarlo.
- **Cámara de comercio: vigente pero con alerta amarilla** — vence el 2026-09-30 (27 días desde la fecha de referencia 2026-09-03); conviene renovarlo si el trámite se va a demorar.
- Resto vigente: RUT (sin fecha de vencimiento), certificación bancaria (2026-12-31) y estados financieros (2027-03-31).
- Advertencia (no bloquea): los cuatro soportes existentes fueron emitidos en Colombia para un cliente de Ecuador.

**Dónde quedó:** `out/ec-corp-andina/` (formulario en `formulario.pdf`, paquete en `out/ec-corp-andina/paquete/`).

No envío nada: queda pendiente el soporte ausente y la confirmación del RUC.

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
