import { limpiarEsquema } from "./esquema"
import { ErrorLLM, type DefHerramienta, type LlamadaHerramienta, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "./adapter"

export interface OpcionesOpenAI {
  nombre: string
  baseUrl: string
  apiKey: string
  modelo: string
  timeoutMs: number
  /** Gemini (endpoint compatible) pide `name` en los mensajes de herramienta. */
  nombreEnTool?: boolean
  /** Gemini 3 exige devolver la thought_signature de cada llamada; los demás proveedores no deben recibirla. */
  reenviarExtra?: boolean
}

interface Choice {
  message?: {
    content?: string | null
    tool_calls?: { id?: string; extra_content?: unknown; function?: { name?: string; arguments?: string } }[]
  }
}
interface Cuerpo {
  choices?: Choice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; code?: string | number; type?: string; status?: string }
}

/** Valor documentado por Google para historiales que no vienen de Gemini. */
const FIRMA_NEUTRA = { google: { thought_signature: "skip_thought_signature_validator" } }

function aWire(m: Mensaje, nombreEnTool: boolean, reenviarExtra: boolean): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.llamadaId, content: m.content, ...(nombreEnTool ? { name: m.nombre } : {}) }
  }
  if (m.role === "assistant" && m.llamadas?.length) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.llamadas.map((l) => ({
        id: l.id,
        type: "function",
        function: { name: l.nombre, arguments: l.argumentos },
        ...(reenviarExtra ? { extra_content: l.extra ?? FIRMA_NEUTRA } : {}),
      })),
    }
  }
  return { role: m.role, content: m.content }
}

function clasificar(status: number, cuerpo: Cuerpo, proveedor: string): ErrorLLM {
  const codigo = String(cuerpo.error?.code ?? cuerpo.error?.type ?? cuerpo.error?.status ?? "")
  const texto = cuerpo.error?.message ?? ""
  if (status === 402 || /insufficient_quota|billing|credit/i.test(codigo + texto)) {
    return new ErrorLLM("creditos", "créditos o cuota agotados", proveedor)
  }
  if (status === 429) return new ErrorLLM("limite", "límite de velocidad del proveedor", proveedor)
  if (status === 408 || status === 504) return new ErrorLLM("timeout", "tiempo de espera agotado", proveedor)
  // No se reenvía el texto crudo del proveedor: podría incluir datos de la petición.
  return new ErrorLLM("otro", `el proveedor respondió con error ${status}`, proveedor)
}

/** Proveedor con API tipo OpenAI /chat/completions (OpenAI, y Gemini por su endpoint compatible). */
export class ProveedorOpenAI implements ProveedorLLM {
  constructor(private readonly o: OpcionesOpenAI) {}
  get nombre(): string {
    return this.o.nombre
  }
  get modelo(): string {
    return this.o.modelo
  }

  async enviar(mensajes: Mensaje[], herramientas: DefHerramienta[]): Promise<RespuestaLLM> {
    const cuerpo = {
      model: this.o.modelo,
      messages: mensajes.map((m) => aWire(m, this.o.nombreEnTool ?? false, this.o.reenviarExtra ?? false)),
      ...(herramientas.length
        ? {
            tools: herramientas.map((h) => ({ type: "function", function: { name: h.name, description: h.description, parameters: limpiarEsquema(h.parameters) } })),
            tool_choice: "auto",
          }
        : {}),
    }
    let res: Response
    try {
      res = await fetch(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    } catch (e) {
      const nombre = e instanceof Error ? e.name : ""
      if (nombre === "TimeoutError" || nombre === "AbortError") throw new ErrorLLM("timeout", "tiempo de espera agotado", this.o.nombre)
      throw new ErrorLLM("otro", "no se pudo conectar con el proveedor", this.o.nombre)
    }
    const json = (await res.json().catch(() => ({}))) as Cuerpo
    if (!res.ok) throw clasificar(res.status, json, this.o.nombre)

    const msg = json.choices?.[0]?.message
    const llamadas: LlamadaHerramienta[] = (msg?.tool_calls ?? []).map((c, i) => ({
      id: c.id || `call_${i}`,
      nombre: c.function?.name ?? "",
      argumentos: c.function?.arguments ?? "{}",
      ...(c.extra_content !== undefined ? { extra: c.extra_content } : {}),
    }))
    return {
      texto: msg?.content ?? null,
      llamadas,
      uso: { entrada: json.usage?.prompt_tokens ?? 0, salida: json.usage?.completion_tokens ?? 0 },
      proveedor: this.o.nombre,
      modelo: this.o.modelo,
    }
  }
}
