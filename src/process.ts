import { herramientas, type ToolContext } from "./tools/proveedor"
import type { Checklist } from "./core/paquete"

interface Respuesta<T> {
  ok: boolean
  error?: string
  codigo?: string
  data?: T
  parcial?: { ruta?: string }
}

function leer<T>(json: string): Respuesta<T> {
  return JSON.parse(json) as Respuesta<T>
}

interface MapeoData {
  llenos: { etiqueta: string }[]
  faltantes: { etiqueta: string }[]
  requiere_confirmacion: { etiqueta: string }[]
}

export interface ResumenCaso {
  caso: string
  ok: boolean
  error?: string
  formato?: string
  total_campos?: number
  llenos?: number
  por_confirmar?: string[]
  faltantes?: string[]
  listo_para_firma?: boolean
  estado_firma?: string
  bloqueadores?: string[]
  alertas?: string[]
  advertencias?: string[]
  formulario?: string
  avisos: string[]
}

/** Corre las herramientas en orden, sin modelo. Un paso fallido no impide los siguientes. */
export async function processCaso(caso: string, ctx: ToolContext): Promise<ResumenCaso> {
  const avisos: string[] = []
  const leerR = leer<{ formato: string }>(await herramientas.leer_solicitud.execute({ caso }, ctx))
  if (leerR.codigo === "caso_no_encontrado" || leerR.codigo === "caso_invalido") {
    return { caso, ok: false, error: leerR.error, avisos }
  }
  if (!leerR.ok) avisos.push(`leer_solicitud: ${leerR.error}`)

  const mapeoR = leer<MapeoData>(await herramientas.mapear_campos.execute({ caso }, ctx))
  if (!mapeoR.ok) avisos.push(`mapear_campos: ${mapeoR.error}`)

  const formR = leer<{ ruta: string }>(await herramientas.generar_formulario.execute({ caso }, ctx))
  if (!formR.ok) avisos.push(`generar_formulario: ${formR.error}`)

  const paqR = leer<{ estado_firma: string; listo_para_firma: boolean; checklist: Checklist }>(
    await herramientas.armar_paquete.execute({ caso }, ctx),
  )
  if (!paqR.ok) avisos.push(`armar_paquete: ${paqR.error}`)

  const m = mapeoR.data
  return {
    caso,
    ok: leerR.ok && mapeoR.ok && paqR.ok,
    formato: leerR.data?.formato,
    total_campos: m ? m.llenos.length + m.faltantes.length + m.requiere_confirmacion.length : undefined,
    llenos: m?.llenos.length,
    por_confirmar: m?.requiere_confirmacion.map((c) => c.etiqueta),
    faltantes: m?.faltantes.map((c) => c.etiqueta),
    listo_para_firma: paqR.data?.listo_para_firma,
    estado_firma: paqR.data?.estado_firma,
    bloqueadores: paqR.data?.checklist.bloqueadores,
    alertas: paqR.data?.checklist.alertas,
    advertencias: paqR.data?.checklist.advertencias,
    formulario: formR.data?.ruta ?? formR.parcial?.ruta,
    avisos,
  }
}
