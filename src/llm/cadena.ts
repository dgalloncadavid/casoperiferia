import { config } from "../config"
import { ErrorLLM, type DefHerramienta, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "./adapter"
import { ProveedorOpenAI } from "./openai"

/** Todos los proveedores configurados fallaron por créditos, límite o tiempo. */
export class CadenaAgotada extends Error {
  constructor(readonly causas: ErrorLLM[]) {
    super("todos los proveedores de modelo no están disponibles")
  }
}

function crearProveedor(nombre: string): ProveedorLLM | null {
  const timeoutMs = config.llmTimeoutMs()
  if (nombre === "openai") {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return null
    return new ProveedorOpenAI({
      nombre,
      apiKey,
      timeoutMs,
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      modelo: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    })
  }
  if (nombre === "google") {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) return null
    return new ProveedorOpenAI({
      nombre,
      apiKey,
      timeoutMs,
      baseUrl: process.env.GOOGLE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
      modelo: process.env.GOOGLE_MODEL ?? "gemini-3.1-flash-lite",
      nombreEnTool: true,
      reenviarExtra: true,
    })
  }
  if (nombre === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) return null
    return new ProveedorOpenAI({
      nombre,
      apiKey,
      timeoutMs,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      modelo: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
    })
  }
  return null
}

export function crearProveedorPorNombre(nombre: string): ProveedorLLM | null {
  return crearProveedor(nombre)
}

export function proveedoresConfigurados(): ProveedorLLM[] {
  return config
    .llmChain()
    .map(crearProveedor)
    .filter((p): p is ProveedorLLM => p !== null)
}

/** Prueba cada proveedor en orden; solo avanza por créditos, límite de velocidad o timeout. */
export class CadenaLLM implements ProveedorLLM {
  constructor(
    private readonly proveedores: ProveedorLLM[],
    /** Se llama cada vez que se pasa al siguiente proveedor (para dejarlo en el log). */
    private readonly alCambiar?: (desde: string, causa: ErrorLLM) => void,
  ) {}
  get nombre(): string {
    return this.proveedores.map((p) => p.nombre).join(">")
  }
  get modelo(): string {
    return this.proveedores[0]?.modelo ?? "ninguno"
  }
  get vacia(): boolean {
    return this.proveedores.length === 0
  }

  async enviar(mensajes: Mensaje[], herramientas: DefHerramienta[]): Promise<RespuestaLLM> {
    const causas: ErrorLLM[] = []
    for (const p of this.proveedores) {
      try {
        return await p.enviar(mensajes, herramientas)
      } catch (e) {
        if (e instanceof ErrorLLM && e.permiteFailover) {
          causas.push(e)
          this.alCambiar?.(p.nombre, e)
          continue
        }
        throw e
      }
    }
    throw new CadenaAgotada(causas)
  }
}

export function crearCadena(alCambiar?: (desde: string, causa: ErrorLLM) => void): CadenaLLM {
  return new CadenaLLM(proveedoresConfigurados(), alCambiar)
}
