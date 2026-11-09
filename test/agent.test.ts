import { beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { manejarChat, type Dependencias } from "../src/agent/ciclo"
import { ErrorLLM, type DefHerramienta, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "../src/llm/adapter"
import { CadenaLLM } from "../src/llm/cadena"
import { limpiarEsquema } from "../src/llm/esquema"
import { ProveedorOpenAI } from "../src/llm/openai"
import { LocalStorage, setStorage } from "../src/storage"
import { definicionesParaModelo } from "../src/agent/herramientas"

const directory = path.resolve(import.meta.dirname, "..")
process.env.FECHA_REFERENCIA = "2026-09-03"

type Paso = (mensajes: Mensaje[]) => Omit<RespuestaLLM, "proveedor" | "modelo" | "uso"> & { uso?: RespuestaLLM["uso"] }

/** Proveedor guionado: cada llamada consume el siguiente paso. */
class Falso implements ProveedorLLM {
  llamadas = 0
  vistas: Mensaje[][] = []
  herramientasVistas: DefHerramienta[][] = []
  constructor(readonly nombre: string, private readonly guion: (Paso | Error)[], readonly modelo = "gpt-4.1-mini") {}
  async enviar(m: Mensaje[], h: DefHerramienta[]): Promise<RespuestaLLM> {
    this.vistas.push(m)
    this.herramientasVistas.push(h)
    const paso = this.guion[this.llamadas++] ?? this.guion[this.guion.length - 1]
    if (paso instanceof Error) throw paso
    const r = (paso as Paso)(m)
    return { proveedor: this.nombre, modelo: this.modelo, uso: r.uso ?? { entrada: 1000, salida: 200 }, texto: r.texto, llamadas: r.llamadas }
  }
}
const llamar = (nombre: string, args: object, id = nombre): Paso => () => ({ texto: null, llamadas: [{ id, nombre, argumentos: JSON.stringify(args) }] })
const decir = (texto: string): Paso => () => ({ texto, llamadas: [] })
const andina = (final: string): Paso[] => [
  llamar("proveedor_leer_solicitud", { caso: "ec-corp-andina" }),
  llamar("proveedor_mapear_campos", { caso: "ec-corp-andina" }),
  llamar("proveedor_generar_formulario", { caso: "ec-corp-andina" }),
  llamar("proveedor_armar_paquete", { caso: "ec-corp-andina" }),
  decir(final),
]

let storage: LocalStorage
let n = 0
function deps(llm: ProveedorLLM | null): Dependencias {
  return { directory, storage, llm }
}
let sid = 0
const nuevaSesion = () => `sesion-de-prueba-${++sid}`

beforeEach(async () => {
  storage = new LocalStorage(path.join(directory, "out", `test-${process.pid}-${++n}`))
  setStorage(storage)
})

describe("ciclo del agente", () => {
  test("Corp Andina: herramientas visibles, pregunta de confirmación reforzada y estado pendiente", async () => {
    const llm = new Falso("falso", andina("Quedaron 14 campos llenos."))
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "Procesa el caso ec-corp-andina" })
    expect(r.toolCalls.map((t) => t.nombre)).toEqual(["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"])
    expect(r.needsConfirmation).toBe(true)
    expect(r.pendiente).toEqual({ caso: "ec-corp-andina", accion: "simular_envio" })
    expect(r.reply).toContain("NO está completo")
    expect(r.reply).toContain("certificado de cumplimiento tributario")
    expect(r.reply).toContain("Número de contribuyente especial")
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(false)
  })

  test("«envía» en el mensaje inmediatamente siguiente escribe solo ENVIO-SIMULADO.md, sin llamar al modelo", async () => {
    const llm = new Falso("falso", andina("ok"))
    const id = nuevaSesion()
    await manejarChat(deps(llm), { sessionId: id, message: "Procesa ec-corp-andina" })
    const antes = llm.llamadas
    const r = await manejarChat(deps(llm), { sessionId: id, message: "Envía." })
    expect(llm.llamadas).toBe(antes)
    expect(r.toolCalls[0]?.nombre).toBe("proveedor_simular_envio")
    expect(r.reply).toContain("INCOMPLETO")
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(true)
    expect(r.needsConfirmation).toBe(false)
  })

  test("el botón estructurado también confirma", async () => {
    const llm = new Falso("falso", andina("ok"))
    const id = nuevaSesion()
    await manejarChat(deps(llm), { sessionId: id, message: "Procesa ec-corp-andina" })
    const r = await manejarChat(deps(llm), { sessionId: id, message: "", confirm: true })
    expect(r.toolCalls[0]?.ok).toBe(true)
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(true)
  })

  test("cualquier otro mensaje cancela la confirmación; un «envía» posterior ya no la libera", async () => {
    const llm = new Falso("falso", [...andina("ok"), decir("Claro, dime."), decir("No hay nada pendiente de confirmar.")])
    const id = nuevaSesion()
    await manejarChat(deps(llm), { sessionId: id, message: "Procesa ec-corp-andina" })
    const r2 = await manejarChat(deps(llm), { sessionId: id, message: "¿qué soportes faltan?" })
    expect(r2.aviso).toContain("se canceló")
    const r3 = await manejarChat(deps(llm), { sessionId: id, message: "envía" })
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(false)
    expect(r3.toolCalls.some((t) => t.nombre === "proveedor_simular_envio" && t.ok)).toBe(false)
  })

  test("el `confirmado: true` que manda el modelo se ignora: pide confirmación al usuario y no envía", async () => {
    const llm = new Falso("falso", [
      ...andina("listo").slice(0, 4),
      llamar("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }),
    ])
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "Procesa y envía ec-corp-andina" })
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(false)
    expect(r.needsConfirmation).toBe(true)
    expect(r.reply).toContain("«envía»")
  })

  test("el modelo no ve los argumentos ignorados (mapeo, campos, confirmado)", async () => {
    const llm = new Falso("falso", [decir("hola")])
    await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "hola" })
    const defs = llm.herramientasVistas[0] as DefHerramienta[]
    const props = (n: string) => Object.keys((defs.find((d) => d.name === n)?.parameters.properties ?? {}) as object)
    expect(props("proveedor_generar_formulario")).toEqual(["caso"])
    expect(props("proveedor_mapear_campos")).toEqual(["caso"])
    expect(props("proveedor_simular_envio")).toEqual(["caso"])
  })

  test("la fecha de referencia va en el prompt de sistema y el cuerpo del cliente llega como dato", async () => {
    const llm = new Falso("falso", [llamar("proveedor_leer_solicitud", { caso: "co-industrias-delta" }), decir("ok")])
    await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "lee co-industrias-delta" })
    const sistema = (llm.vistas[0] as Mensaje[])[0]
    expect(sistema?.role === "system" && sistema.content).toContain("2026-09-03")
    const tool = (llm.vistas[1] as Mensaje[]).find((m) => m.role === "tool")
    expect(tool?.role === "tool" && tool.content).toContain("cuerpo_cliente_no_confiable")
  })

  test("tope de iteraciones: responde con lo que tiene", async () => {
    process.env.MAX_ITERATIONS = "3"
    try {
      const llm = new Falso("falso", [llamar("proveedor_leer_solicitud", { caso: "ec-corp-andina" })])
      const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "lee ec-corp-andina" })
      expect(llm.llamadas).toBe(3)
      expect(r.reply).toContain("tope de 3 pasos")
    } finally {
      delete process.env.MAX_ITERATIONS
    }
  })

  test("argumentos del modelo inválidos o herramienta inventada: error devuelto al modelo, sin romper", async () => {
    const llm = new Falso("falso", [
      () => ({ texto: null, llamadas: [{ id: "a", nombre: "proveedor_leer_solicitud", argumentos: "{no es json" }, { id: "b", nombre: "borrar_todo", argumentos: "{}" }] }),
      decir("No pude leer."),
    ])
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "lee" })
    expect(r.toolCalls.map((t) => t.ok)).toEqual([false, false])
    expect(r.reply).toBe("No pude leer.")
  })
})

describe("topes y modo sin modelo", () => {
  test("sin modelo: procesa Corp Andina con processCaso(), avisa y pide confirmación", async () => {
    const r = await manejarChat(deps(null), { sessionId: nuevaSesion(), message: "Procesa el caso ec-corp-andina" })
    expect(r.modo).toBe("sin_modelo")
    expect(r.aviso).toContain("modo sin modelo")
    expect(r.reply).toContain("Número de contribuyente especial")
    expect(r.reply).toContain("certificado de cumplimiento tributario")
    expect(r.needsConfirmation).toBe(true)
  })

  test("sin modelo: «envía» tras la propuesta escribe ENVIO-SIMULADO.md", async () => {
    const id = nuevaSesion()
    await manejarChat(deps(null), { sessionId: id, message: "ec-corp-andina" })
    await manejarChat(deps(null), { sessionId: id, message: "envía" })
    expect(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")).toBe(true)
  })

  test("tope de tokens por sesión: pasa a sin modelo y lo avisa", async () => {
    process.env.SESSION_TOKEN_CAP = "1100"
    try {
      const llm = new Falso("falso", [decir("primera")])
      const id = nuevaSesion()
      const r1 = await manejarChat(deps(llm), { sessionId: id, message: "hola" })
      expect(r1.modo).toBe("modelo")
      const r2 = await manejarChat(deps(llm), { sessionId: id, message: "procesa ec-corp-andina" })
      expect(r2.modo).toBe("sin_modelo")
      expect(r2.aviso).toContain("tope de tokens")
      expect(llm.llamadas).toBe(1)
    } finally {
      delete process.env.SESSION_TOKEN_CAP
    }
  })

  test("tope global de gasto diario: modo sin modelo con aviso en pantalla", async () => {
    await storage.addUsage(new Date().toISOString().slice(0, 10), { tokensEntrada: 0, tokensSalida: 0, costoUsd: 5.01, peticiones: 1 })
    const llm = new Falso("falso", [decir("no debería llamarse")])
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "procesa co-industrias-delta" })
    expect(llm.llamadas).toBe(0)
    expect(r.modo).toBe("sin_modelo")
    expect(r.aviso).toContain("tope de gasto diario")
  })

  test("el consumo de cada llamada se suma al gasto global", async () => {
    const llm = new Falso("falso", [decir("hola")], "gpt-4.1-mini")
    await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "hola" })
    const u = await storage.getUsage(new Date().toISOString().slice(0, 10))
    expect(u.peticiones).toBe(1)
    expect(u.costoUsd).toBeCloseTo((1000 * 0.4 + 200 * 1.6) / 1e6, 8)
  })
})

describe("cadena de proveedores", () => {
  const limite = () => new ErrorLLM("limite", "límite", "a")
  test("pasa al siguiente por límite, créditos o timeout y lo registra", async () => {
    for (const tipo of ["limite", "creditos", "timeout"] as const) {
      const cambios: string[] = []
      const a = new Falso("a", [new ErrorLLM(tipo, "x", "a")])
      const b = new Falso("b", [decir("desde b")])
      const r = await new CadenaLLM([a, b], (d, c) => cambios.push(`${d}:${c.tipo}`)).enviar([], [])
      expect(r.proveedor).toBe("b")
      expect(cambios).toEqual([`a:${tipo}`])
    }
  })
  test("NO cambia por otros errores (p. ej. de contenido)", async () => {
    const a = new Falso("a", [new ErrorLLM("otro", "400", "a")])
    const b = new Falso("b", [decir("no")])
    await expect(new CadenaLLM([a, b]).enviar([], [])).rejects.toBeInstanceOf(ErrorLLM)
    expect(b.llamadas).toBe(0)
  })
  test("si fallan todos, el chat sigue en modo sin modelo con processCaso()", async () => {
    const llm = new CadenaLLM([new Falso("a", [limite()]), new Falso("b", [limite()])])
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "procesa hn-agroexport-sula" })
    expect(r.modo).toBe("sin_modelo")
    expect(r.aviso).toContain("no están disponibles")
    expect(r.reply).toContain("parafiscales")
  })
  test("si el modelo falla a mitad del turno, las llamadas ya hechas siguen visibles", async () => {
    const llm = new Falso("a", [llamar("proveedor_leer_solicitud", { caso: "ec-corp-andina" }), new ErrorLLM("otro", "el proveedor respondió con error 400", "a")])
    const r = await manejarChat(deps(llm), { sessionId: nuevaSesion(), message: "lee ec-corp-andina" })
    expect(r.reply).toContain("No pude consultar el modelo")
    expect(r.toolCalls.map((t) => t.nombre)).toEqual(["proveedor_leer_solicitud"])
  })
  test("un error no recuperable se muestra claro y la sesión no muere", async () => {
    const id = nuevaSesion()
    const llm = new Falso("a", [new ErrorLLM("otro", "el proveedor respondió con error 400", "a"), decir("de vuelta")])
    const r1 = await manejarChat(deps(llm), { sessionId: id, message: "hola" })
    expect(r1.reply).toContain("No pude consultar el modelo")
    const r2 = await manejarChat(deps(llm), { sessionId: id, message: "hola otra vez" })
    expect(r2.reply).toBe("de vuelta")
  })
})

describe("esquemas", () => {
  test("limpiarEsquema quita claves que algunos proveedores rechazan", () => {
    const e = limpiarEsquema({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { type: "string", default: "z" } } })
    expect(JSON.stringify(e)).toBe('{"type":"object","properties":{"a":{"type":"string"}}}')
  })
  test("las definiciones para el modelo salen de zod con descripción", () => {
    const d = definicionesParaModelo().find((x) => x.name === "proveedor_leer_solicitud")
    expect(JSON.stringify(d?.parameters)).toContain("Nombre de la carpeta del caso")
  })
})

describe("adaptador OpenAI-compatible (fetch simulado)", () => {
  const original = globalThis.fetch
  const restaurar = () => {
    globalThis.fetch = original
  }
  const crear = (nombreEnTool = false, reenviarExtra = false) =>
    new ProveedorOpenAI({ nombre: "x", baseUrl: "https://ejemplo.test/v1", apiKey: "clave-de-prueba", modelo: "m", timeoutMs: 500, nombreEnTool, reenviarExtra })

  test("envía esquemas limpios, convierte herramientas y lee tool_calls y uso", async () => {
    let cuerpo: Record<string, unknown> = {}
    let auth = ""
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>
      auth = String((init?.headers as Record<string, string>).authorization)
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "", function: { name: "proveedor_leer_solicitud", arguments: '{"caso":"x"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })
    }) as unknown as typeof fetch
    try {
      const msgs: Mensaje[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: null, llamadas: [{ id: "c1", nombre: "t", argumentos: "{}" }] }, { role: "tool", llamadaId: "c1", nombre: "t", content: "{}" }]
      const r = await crear(true).enviar(msgs, definicionesParaModelo())
      expect(JSON.stringify(cuerpo)).not.toContain("$schema")
      expect(auth).toBe("Bearer clave-de-prueba")
      const wire = cuerpo.messages as Record<string, unknown>[]
      expect(wire[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "{}", name: "t" })
      expect(r.llamadas).toEqual([{ id: "call_0", nombre: "proveedor_leer_solicitud", argumentos: '{"caso":"x"}' }])
      expect(r.uso).toEqual({ entrada: 12, salida: 3 })
    } finally {
      restaurar()
    }
  })

  test("devuelve tal cual el extra_content de las llamadas (thought_signature de Gemini 3)", async () => {
    const enviados: Record<string, unknown>[] = []
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      enviados.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "c9", extra_content: { google: { thought_signature: "FIRMA" } }, function: { name: "t", arguments: "{}" } }] } }] })
    }) as unknown as typeof fetch
    try {
      const p = crear(false, true)
      const r = await p.enviar([{ role: "user", content: "u" }], [])
      expect(r.llamadas[0]?.extra).toEqual({ google: { thought_signature: "FIRMA" } })
      await p.enviar([{ role: "user", content: "u" }, { role: "assistant", content: null, llamadas: r.llamadas }, { role: "tool", llamadaId: "c9", nombre: "t", content: "{}" }], [])
      const wire = enviados[1]?.messages as { tool_calls?: { extra_content?: unknown }[] }[]
      expect(wire[1]?.tool_calls?.[0]?.extra_content).toEqual({ google: { thought_signature: "FIRMA" } })
      // Historial que viene de otro proveedor: Gemini recibe la firma neutra documentada.
      await p.enviar([{ role: "assistant", content: null, llamadas: [{ id: "z", nombre: "t", argumentos: "{}" }] }], [])
      const ajeno = enviados[2]?.messages as { tool_calls?: { extra_content?: unknown }[] }[]
      expect(ajeno[0]?.tool_calls?.[0]?.extra_content).toEqual({ google: { thought_signature: "skip_thought_signature_validator" } })
      // Un proveedor que no es Gemini nunca recibe extra_content.
      await crear(false, false).enviar([{ role: "assistant", content: null, llamadas: [{ id: "z", nombre: "t", argumentos: "{}", extra: { google: { thought_signature: "X" } } }] }], [])
      const otro = enviados[3]?.messages as { tool_calls?: Record<string, unknown>[] }[]
      expect(otro[0]?.tool_calls?.[0]).not.toHaveProperty("extra_content")
    } finally {
      restaurar()
    }
  })

  test("clasifica 429 con insufficient_quota como créditos, 429 como límite y no filtra el texto del proveedor", async () => {
    const responder = (status: number, error: object) => {
      globalThis.fetch = (async () => Response.json({ error }, { status })) as unknown as typeof fetch
    }
    try {
      responder(429, { code: "insufficient_quota", message: "You exceeded your current quota" })
      await expect(crear().enviar([], [])).rejects.toMatchObject({ tipo: "creditos" })
      responder(429, { message: "Rate limit reached" })
      await expect(crear().enviar([], [])).rejects.toMatchObject({ tipo: "limite" })
      responder(400, { message: "contenido con datos sensibles" })
      const e = await crear().enviar([], []).catch((x: Error) => x)
      expect(e).toMatchObject({ tipo: "otro" })
      expect((e as Error).message).not.toContain("sensibles")
    } finally {
      restaurar()
    }
  })

  test("timeout y fallo de red", async () => {
    try {
      globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch
      await expect(crear().enviar([], [])).rejects.toMatchObject({ tipo: "timeout" })
      globalThis.fetch = (async () => {
        throw new Error("ECONNRESET")
      }) as unknown as typeof fetch
      await expect(crear().enviar([], [])).rejects.toMatchObject({ tipo: "otro" })
    } finally {
      restaurar()
    }
  })
})
