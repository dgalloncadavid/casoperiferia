import type { ResumenCaso } from "../process"
import type { VistaLlamada } from "./tipos"

export const nombreFormato = (f: string | undefined): string =>
  f === "xlsx" ? "Excel" : f === "pdf" ? "PDF" : f === "portal" ? "portal web" : "formato desconocido"

const LISTA = (xs: string[] | undefined, vacio: string) => (xs && xs.length ? xs.join("; ") : vacio)

/** Resumen determinista de un caso (modo sin modelo y topes). Habla en lenguaje de la analista. */
export function textoResumen(r: ResumenCaso, fecha: string): string {
  if (!r.ok && r.error && r.total_campos === undefined) return `No pude procesar «${r.caso}»: ${r.error}.`
  const firma =
    r.estado_firma === "listo"
      ? "Sí, el paquete está listo para firma."
      : r.estado_firma === "no_aplica"
        ? "No aplica: es un portal, así que dejé los valores listos para copiar."
        : "No, el paquete todavía no está listo para firma."
  const partes = [
    `Caso ${r.caso} (${nombreFormato(r.formato)}), soportes evaluados al ${fecha}.`,
    `Campos: ${r.total_campos ?? 0}. Llenos: ${r.llenos ?? 0}.`,
    `Por confirmar: ${LISTA(r.por_confirmar, "ninguno")}.`,
    `Faltantes (no bloquean la firma): ${LISTA(r.faltantes, "ninguno")}.`,
    firma,
  ]
  if (r.bloqueadores?.length) partes.push(`Qué lo bloquea: ${r.bloqueadores.join("; ")}.`)
  if (r.alertas?.length) partes.push(`Alertas de vigencia: ${r.alertas.join("; ")}.`)
  if (r.advertencias?.length) partes.push(`Advertencias: ${r.advertencias.join("; ")}.`)
  if (r.avisos.length) partes.push(`Avisos: ${r.avisos.join("; ")}.`)
  partes.push("Dejé el formulario y el paquete en la carpeta del caso; puedes descargarlos desde el panel del caso.")
  return partes.join("\n")
}

export function textoConfirmacion(caso: string, incompleto: boolean, pendientes: string[], faltantes: string[]): string {
  const cierre = "Para continuar escribe «envía» o pulsa el botón. Cualquier otro mensaje cancela la confirmación."
  if (!incompleto) {
    return `¿Confirmas el envío simulado del caso ${caso}? Solo se dejará una constancia del envío; no se manda nada real.\n${cierre}`
  }
  return [
    `⚠ El caso ${caso} NO está completo. Si confirmas, el envío simulado quedará marcado como INCOMPLETO.`,
    `Pendientes que bloquean la firma: ${LISTA(pendientes, "ninguno")}.`,
    `Campos faltantes: ${LISTA(faltantes, "ninguno")}.`,
    `¿Quieres enviarlo así de todas formas?`,
    cierre,
  ].join("\n")
}

export function textoTopeIteraciones(max: number, llamadas: VistaLlamada[]): string {
  const hechas = llamadas.map((l) => `${l.nombre} (${l.ok ? "ok" : "error"})`).join(", ") || "ninguna herramienta"
  return `Llegué al tope de ${max} pasos en este turno. Esto es lo que alcancé a hacer: ${hechas}. Dime si quieres que continúe o que revise algo específico.`
}
