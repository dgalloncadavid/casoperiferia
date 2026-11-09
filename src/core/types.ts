export interface ToolContext {
  /** Raíz del proyecto. */
  directory: string
  sessionId: string
  /** AAAA-MM-DD. Si falta: FECHA_REFERENCIA o 2026-09-03. */
  fechaReferencia?: string
  /** Carpeta de casos, relativa a directory; debe estar bajo fixtures/ o fixtures-test/. */
  casosRoot?: string
}

export interface Fail {
  ok: false
  error: string
  codigo?: string
  /** Lo que sí se pudo hacer pese al error. */
  parcial?: unknown
}
export type Result<T> = { ok: true; data: T } | Fail

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const fail = (error: string, codigo?: string, parcial?: unknown): Fail => ({
  ok: false,
  error,
  ...(codigo ? { codigo } : {}),
  ...(parcial !== undefined ? { parcial } : {}),
})

export type Formato = "xlsx" | "pdf" | "portal"

export interface Solicitud {
  id: string
  de: string
  asunto: string
  fecha: string
  pais: string
  cliente: string
  cuerpo: string
  formato: Formato
  adjuntos: string[]
}

export interface CampoPlantilla {
  etiqueta: string
  obligatorio?: boolean
  hoja?: string
  celda_etiqueta?: string
  celda_valor?: string
}

export type EstadoCampo = "lleno" | "requiere_confirmacion" | "faltante"

export interface CampoMapeado {
  etiqueta: string
  estado: EstadoCampo
  confianza: number
  clave?: string
  ruta_maestro?: string
  valor?: string
  nota?: string
  obligatorio?: boolean
  hoja?: string
  celda_etiqueta?: string
  celda_valor?: string
}

export type EstadoSoporte = "vigente" | "vencido" | "ausente"
export type Alerta = "verde" | "amarilla" | "roja"

export interface SoporteEval {
  tipo: string
  estado: EstadoSoporte
  alerta: Alerta
  archivo?: string
  vigencia_hasta: string | null
  dias_restantes: number | null
  pais_emisor?: string
  advertencia?: string
}
