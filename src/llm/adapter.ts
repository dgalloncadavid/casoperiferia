export interface LlamadaHerramienta {
  id: string
  nombre: string
  /** JSON serializado, tal como lo devuelve el modelo. */
  argumentos: string
}

export type Mensaje =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; llamadas?: LlamadaHerramienta[] }
  | { role: "tool"; llamadaId: string; nombre: string; content: string }

export interface DefHerramienta {
  name: string
  description: string
  /** JSON Schema del objeto de argumentos. */
  parameters: Record<string, unknown>
}

export interface Uso {
  entrada: number
  salida: number
}

export interface RespuestaLLM {
  texto: string | null
  llamadas: LlamadaHerramienta[]
  uso: Uso
  proveedor: string
  modelo: string
}

/** Interfaz propia del PRD: cambiar de proveedor no toca el ciclo del agente. */
export interface ProveedorLLM {
  readonly nombre: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefHerramienta[]): Promise<RespuestaLLM>
}

export type TipoErrorLLM = "creditos" | "limite" | "timeout" | "otro"

export class ErrorLLM extends Error {
  constructor(
    readonly tipo: TipoErrorLLM,
    mensaje: string,
    readonly proveedor: string,
  ) {
    super(mensaje)
  }
  /** Solo estos tipos justifican pasar al siguiente proveedor. */
  get permiteFailover(): boolean {
    return this.tipo !== "otro"
  }
}
