import { access } from "node:fs/promises"
import path from "node:path"
import type { IndiceSoportes } from "./fixtures"
import { nombrePais } from "./mapeo"
import type { Alerta, SoporteEval } from "./types"
import { diasEntre } from "./util"

const NOMBRES_SOPORTE: Record<string, string> = {
  camara_comercio: "Cámara de Comercio",
  rut: "RUT",
  certificacion_bancaria: "certificación bancaria",
  parafiscales: "certificado de aportes parafiscales",
  estados_financieros: "estados financieros",
  certificado_iso_9001: "certificado ISO 9001",
  certificado_cumplimiento_tributario: "certificado de cumplimiento tributario",
}

/** Nombre del soporte como lo diría la analista (el tipo interno no se muestra). */
export function nombreSoporte(tipo: string): string {
  return NOMBRES_SOPORTE[tipo] ?? tipo.replace(/_/g, " ")
}

export const UMBRAL_AMARILLA = 30
export const UMBRAL_ROJA = 15

function alertaPorDias(dias: number | null): Alerta {
  if (dias === null) return "verde"
  if (dias < UMBRAL_ROJA) return "roja"
  if (dias < UMBRAL_AMARILLA) return "amarilla"
  return "verde"
}

async function existe(ruta: string): Promise<boolean> {
  return access(ruta).then(
    () => true,
    () => false,
  )
}

export async function evaluarSoportes(
  exigidos: string[],
  indice: IndiceSoportes,
  dirSoportes: string,
  paisCaso: string,
  fecha: string,
): Promise<SoporteEval[]> {
  const resultado: SoporteEval[] = []
  for (const tipo of exigidos) {
    const entrada = indice.find((s) => s.tipo === tipo)
    const archivoValido = entrada && path.basename(entrada.archivo) === entrada.archivo
    if (!entrada || !archivoValido || !(await existe(path.join(dirSoportes, entrada.archivo)))) {
      resultado.push({ tipo, estado: "ausente", alerta: "roja", vigencia_hasta: null, dias_restantes: null })
      continue
    }
    const dias = entrada.vigencia_hasta === null ? null : diasEntre(fecha, entrada.vigencia_hasta)
    const vencido = dias !== null && dias < 0
    resultado.push({
      tipo,
      archivo: entrada.archivo,
      estado: vencido ? "vencido" : "vigente",
      alerta: vencido ? "roja" : alertaPorDias(dias),
      vigencia_hasta: entrada.vigencia_hasta,
      dias_restantes: dias,
      pais_emisor: entrada.pais_emisor,
      ...(entrada.pais_emisor !== paisCaso
        ? { advertencia: `emitido en ${nombrePais(entrada.pais_emisor)}; el cliente es de ${nombrePais(paisCaso)}` }
        : {}),
    })
  }
  return resultado
}

export function describirSoporte(s: SoporteEval): string {
  const nombre = nombreSoporte(s.tipo)
  if (s.estado === "ausente") return `${nombre}: no está en el repositorio`
  if (s.estado === "vencido") return `${nombre}: venció el ${s.vigencia_hasta}`
  if (s.dias_restantes !== null && s.alerta !== "verde") {
    return `${nombre}: vence el ${s.vigencia_hasta} (quedan ${s.dias_restantes} días)`
  }
  return `${nombre}: vigente`
}
