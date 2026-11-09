import { beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { app, _setDependencias } from "../src/server"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
let storage: LocalStorage
let n = 0

beforeEach(() => {
  storage = new LocalStorage(path.join(directory, "out", `test-srv-${process.pid}-${++n}`))
  setStorage(storage)
  _setDependencias({ directory, storage, llm: null })
  delete process.env.RESET_KEY
  delete process.env.RATE_LIMIT_PER_MIN
  process.env.FECHA_REFERENCIA = "2026-09-03"
})

const post = (body: unknown, ip = "1.1.1.1") =>
  app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) })

describe("API", () => {
  test("GET /api/health: proveedor, modelo y fecha de referencia, sin claves", async () => {
    process.env.OPENAI_API_KEY = "sk-clave-secreta-de-prueba"
    try {
      const r = await app.request("/api/health")
      const j = (await r.json()) as Record<string, unknown>
      expect(r.status).toBe(200)
      expect(j.ok).toBe(true)
      expect(j.fechaReferencia).toBe("2026-09-03")
      expect(j.provider).toBe("openai")
      expect(j.model).toBe("gpt-4.1-mini")
      expect(JSON.stringify(j)).not.toContain("clave-secreta")
    } finally {
      delete process.env.OPENAI_API_KEY
    }
  })

  test("POST /api/chat devuelve {reply, toolCalls, needsConfirmation} y GET /api/sessions/:id el historial", async () => {
    const r = await post({ sessionId: "sesion-servidor-1", message: "procesa ec-corp-andina" })
    const j = (await r.json()) as { reply: string; toolCalls: unknown[]; needsConfirmation: boolean; modo: string }
    expect(r.status).toBe(200)
    expect(j.modo).toBe("sin_modelo")
    expect(j.needsConfirmation).toBe(true)
    expect(Array.isArray(j.toolCalls)).toBe(true)
    const s = await app.request("/api/sessions/sesion-servidor-1")
    const h = (await s.json()) as { historial: { rol: string }[]; pendiente: { caso: string } }
    expect(h.historial.map((x) => x.rol)).toEqual(["user", "assistant"])
    expect(h.pendiente.caso).toBe("ec-corp-andina")
    expect((await app.request("/api/sessions/no-existe-1234")).status).toBe(404)
    expect((await app.request("/api/sessions/..%2Fetc")).status).toBe(400)
  })

  test("validaciones: JSON inválido, mensaje vacío, id inválido y mensaje demasiado largo", async () => {
    expect((await app.request("/api/chat", { method: "POST", body: "no json" })).status).toBe(400)
    expect((await post({ sessionId: "sesion-servidor-2", message: "  " })).status).toBe(400)
    expect((await post({ sessionId: "../x", message: "hola" })).status).toBe(400)
    expect((await post({ sessionId: "sesion-servidor-3", message: "a".repeat(2001) })).status).toBe(413)
  })

  test("límite por IP: el mensaje 21 en un minuto recibe 429; otra IP no se ve afectada", async () => {
    for (let i = 0; i < 20; i++) expect((await post({ sessionId: "sesion-rate-limit", message: "hola" }, "9.9.9.9")).status).toBe(200)
    const r = await post({ sessionId: "sesion-rate-limit", message: "hola" }, "9.9.9.9")
    expect(r.status).toBe(429)
    expect(r.headers.get("retry-after")).toBe("60")
    expect((await post({ sessionId: "sesion-rate-limit-2", message: "hola" }, "8.8.8.8")).status).toBe(200)
  })

  test("descarga del paquete: lista, descarga y rechaza rutas inválidas o internas", async () => {
    await post({ sessionId: "sesion-descarga-1", message: "procesa co-industrias-delta" })
    const lista = (await (await app.request("/api/paquetes/co-industrias-delta")).json()) as { archivos: string[] }
    expect(lista.archivos).toContain("paquete/checklist.md")
    expect(lista.archivos.some((a) => a.endsWith("log.jsonl") || a.endsWith("estado.json"))).toBe(false)
    const ok = await app.request("/api/paquetes/co-industrias-delta/paquete/checklist.md")
    expect(ok.status).toBe(200)
    expect(ok.headers.get("content-disposition")).toContain("attachment")
    expect(await ok.text()).toContain("Checklist")
    for (const mala of ["/api/paquetes/co-industrias-delta/..%2F..%2Fpackage.json", "/api/paquetes/co-industrias-delta/estado.json", "/api/paquetes/co-industrias-delta/log.jsonl", "/api/paquetes/co-industrias-delta/%2e%2e/%2e%2e/.env", "/api/paquetes/sessions", "/api/paquetes/..%2Fsrc", "/api/paquetes/err-inyeccion"]) {
      expect([400, 404]).toContain((await app.request(mala)).status)
    }
  })

  test("reset: deshabilitado sin RESET_KEY, 401 con clave errónea, borra con la correcta y conserva el consumo", async () => {
    expect((await app.request("/api/reset", { method: "POST" })).status).toBe(404)
    process.env.RESET_KEY = "reset-de-prueba"
    expect((await app.request("/api/reset", { method: "POST", headers: { "x-reset-key": "otra" } })).status).toBe(401)
    expect((await app.request("/api/reset", { method: "POST" })).status).toBe(401)
    await post({ sessionId: "sesion-reset-1", message: "procesa co-industrias-delta" })
    await storage.addUsage("2026-01-01", { tokensEntrada: 1, tokensSalida: 1, costoUsd: 1, peticiones: 1 })
    expect((await app.request("/api/reset", { method: "POST", headers: { "x-reset-key": "reset-de-prueba" } })).status).toBe(200)
    expect(await storage.exists("co-industrias-delta/formulario.xlsx")).toBe(false)
    expect((await app.request("/api/sessions/sesion-reset-1")).status).toBe(404)
    expect((await storage.getUsage("2026-01-01")).costoUsd).toBe(1)
  })
})
