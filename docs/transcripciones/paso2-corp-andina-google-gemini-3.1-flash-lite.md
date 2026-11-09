# Transcripción: Corp Andina de punta a punta (google-gemini-3.1-flash-lite)

Fecha de referencia: 2026-09-03

## Usuario

Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

- `proveedor_leer_solicitud` {"caso":"ec-corp-andina"} → ok: formato pdf, 15 campos, 5 soportes exigidos
- `proveedor_mapear_campos` {"caso":"ec-corp-andina"} → ok: 13 llenos, 1 por confirmar, 1 faltantes
- `proveedor_generar_formulario` {"caso":"ec-corp-andina"} → ok: pdf → out/ec-corp-andina/formulario.pdf
- `proveedor_armar_paquete` {"caso":"ec-corp-andina"} → ok: paquete bloqueado → out/ec-corp-andina/paquete/

## Asistente (modelo, google/gemini-3.1-flash-lite, 28.9 s)

He procesado la solicitud para el caso **ec-corp-andina**. Aquí tienes el resumen:

*   **Llenos:** 13 campos han sido completados correctamente desde el repositorio maestro.
*   **Por confirmar:** 1 campo (**RUC**). Se ha utilizado el NIT colombiano, por lo que debes validar si es aceptado como identificador extranjero.
*   **Faltantes:** 1 campo (**Número de contribuyente especial**). Este campo no existe en el maestro, pero al ser opcional, no bloquea el proceso.
*   **¿Listo para firma?** No. El paquete está bloqueado debido a la ausencia del *certificado de cumplimiento tributario*.
*   **Soportes a actualizar:**
    *   **Certificado de cumplimiento tributario:** Ausente (bloquea la firma).
    *   **Cámara de Comercio:** Vigente, pero tiene una alerta **amarilla** al vencer en menos de 30 días (2026-09-30). 
    *   *Nota:* Se incluyen advertencias ya que los soportes emitidos en Colombia (RUT, Cámara de Comercio, certificación bancaria y estados financieros) se están presentando para un cliente en Ecuador.

El formulario y el paquete han sido generados y se encuentran disponibles en la ruta: `out/ec-corp-andina/paquete/`.

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
