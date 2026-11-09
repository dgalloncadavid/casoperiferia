---
# GENERADO por scripts/build-modulo.ts desde las fuentes de la aplicación. No editar a mano: se pierde al regenerar y test/modulo.test.ts falla si se desalinea.
name: registro-proveedor
description: "Conocimiento del proceso de registro como proveedor: qué pide cada país, estados de un campo, vigencia de soportes, datos bancarios, portales y paquete para firma."
---

# Registro como proveedor: conocimiento del proceso

## Flujo
Un cliente (Colombia, Ecuador, Perú, Panamá u Honduras) envía por correo una solicitud para que Periferia se registre como proveedor. Pide un formulario en Excel, en PDF o en un portal web, más una lista de soportes. La analista prepara el formulario y el paquete; el representante legal firma; una persona envía. El agente solo prepara.

## Identificador tributario por país
| País | Etiqueta local |
|---|---|
| Colombia | NIT |
| Ecuador, Perú, Panamá | RUC |
| Honduras | RTN |

Periferia solo tiene NIT colombiano. Fuera de Colombia, el campo se llena con el NIT y queda **por confirmar** con la nota «identificador extranjero». El dígito de verificación solo existe en Colombia.

## Estados de un campo
- **lleno:** tiene fuente en el maestro y confianza ≥ 0.8.
- **requiere_confirmacion:** hay valor, pero la confianza es < 0.8 (regla de identificador o de moneda). La analista debe confirmarlo.
- **faltante:** no existe en el maestro. Nunca se inventa. No bloquea la firma, pero aparece en el checklist (p. ej. número de contribuyente especial, referencias comerciales).

## Ingresos
Se escriben con moneda y año, p. ej. «98.000.000.000 COP (2025)». No se convierte la moneda. Quedan por confirmar.

## Soportes y vigencia
Cada soporte exigido queda **vigente**, **vencido** o **ausente**, evaluado contra la fecha de referencia.
- Vencido o ausente: **bloquea** el estado «listo para firma».
- Vigente con menos de 30 días: alerta **amarilla**. Con menos de 15: alerta **roja**.
- Un soporte emitido en otro país (p. ej. un RUT colombiano para un cliente de Honduras) se incluye con una **advertencia**, no bloquea.
- «Cámara de Comercio no mayor a 30 días» se evalúa con la vigencia del certificado.

## Datos bancarios
Solo se llenan si la plantilla los pide explícitamente. Nunca van en el borrador de correo.

## Portal web
No se automatiza. Se entrega `valores-portal.md` con los valores en el orden del formulario. Las credenciales las tiene el representante legal; el ingreso de credenciales y el clic en «Enviar» son humanos. El agente nunca ve ni pide credenciales.

## Paquete para firma
`out/<caso>/paquete/` contiene el formulario, copias de los soportes que existan, `checklist.md` y `borrador-correo.md`. El envío es simulado (`ENVIO-SIMULADO.md`) y exige confirmación explícita del usuario en el mensaje inmediatamente siguiente. Si el paquete está incompleto, el envío queda marcado como incompleto.
