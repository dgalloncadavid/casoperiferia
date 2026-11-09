import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { _setVerificador, type Usuario } from "../src/auth"
import { app, fechaColombia, _setDependencias } from "../src/server"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const A: Usuario = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "sofia@casoperiferia.dev" }
const B: Usuario = { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "evaluador@casoperiferia.dev" }
const TOKENS: Record<string, Usuario> = { "token-de-a": A, "token-de-b": B }
let storage: LocalStorage
let n = 0
const guardado = { ...process.env }

beforeEach(() => {
  storage = new LocalStorage(path.join(directory, "out", `test-auth-${process.pid}-${++n}`))
  setStorage(storage)
  _setDependencias({ directory, storage, llm: null })
  process.env.AUTH = "on"
  process.env.SUPABASE_URL = "https://proyecto-de-prueba.supabase.co"
  process.env.SUPABASE_ANON_KEY = "anon-publica-de-prueba"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-SECRETA-que-no-debe-salir"
  process.env.FECHA_REFERENCIA = "2026-09-03"
  delete process.env.RATE_LIMIT_PER_MIN
  _setVerificador(async (t) => TOKENS[t] ?? null)
})
afterEach(() => {
  _setVerificador(null)
  process.env.AUTH = "off"
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (guardado[k] === undefined) delete process.env[k]
    else process.env[k] = guardado[k]
  }
})

const como = (token: string | null): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})
const get = (ruta: string, token: string | null = null) => app.request(ruta, { headers: como(token) })
const chat = (token: string | null, cuerpo: Record<string, unknown>) =>
  app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json", ...como(token) }, body: JSON.stringify(cuerpo) })
const json = async <T>(r: Response) => (await r.json()) as T
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("login: 401 sin token válido, rutas públicas, y configuración sin secretos", () => {
  test("sin token, con token mal formado o inválido: 401 en todas las rutas protegidas", async () => {
    const rutas: [string, string][] = [
      ["GET", "/api/casos?fecha=2026-09-03"], ["GET", "/api/casos/resumen"], ["GET", "/api/casos/resumen?fecha=2026-09-03"], ["GET", "/api/casos/co-industrias-delta"], ["GET", "/api/reporte"], ["GET", "/api/sessions"],
      ["GET", "/api/sessions/sesion-cualquiera-1"], ["GET", "/api/paquetes/co-industrias-delta"], ["GET", "/api/paquetes/co-industrias-delta/formulario.xlsx"], ["GET", "/api/paquetes/co-industrias-delta/paquete/checklist.md"], ["POST", "/api/chat"], ["POST", "/api/casos/co-industrias-delta/procesar"],
      ["POST", "/api/casos/co-industrias-delta/decisiones"], ["POST", "/api/casos/co-industrias-delta/proponer-envio"], ["POST", "/api/reset"],
    ]
    for (const cab of [{} as Record<string, string>, { authorization: "Bearer" }, { authorization: "Basic abc" }, { authorization: "Bearer token-falso" }, { authorization: "token-de-a" }]) {
      for (const [metodo, ruta] of rutas) {
        const r = await app.request(ruta, { method: metodo, headers: { "content-type": "application/json", ...cab }, body: metodo === "POST" ? "{}" : undefined })
        expect(r.status, `${metodo} ${ruta} con ${JSON.stringify(cab)}`).toBe(401)
        expect(((await r.json()) as { error: string }).error).toBe("Inicia sesión para continuar.")
      }
    }
  })

  test("con un token válido se accede", async () => {
    expect((await get("/api/casos?fecha=2026-09-03", "token-de-a")).status).toBe(200)
    expect((await get("/api/sessions", "token-de-b")).status).toBe(200)
  })

  test("/api/health y /api/config son públicos", async () => {
    const h = await get("/api/health")
    expect(h.status).toBe(200)
    expect(((await json<{ auth: string }>(h)).auth)).toBe("on")
    expect((await get("/api/config")).status).toBe(200)
  })

  test("/api/config entrega la URL y la clave anon, pero NUNCA la service role", async () => {
    const texto = await (await get("/api/config")).text()
    const cfg = JSON.parse(texto) as Record<string, unknown>
    expect(cfg).toEqual({ authEnabled: true, supabaseUrl: "https://proyecto-de-prueba.supabase.co", supabaseAnonKey: "anon-publica-de-prueba" })
    expect(texto).not.toMatch(/service|SECRETA/i)
  })

  test("con AUTH=off la configuración dice que no hay login y no trae claves", async () => {
    process.env.AUTH = "off"
    expect(await json(await get("/api/config"))).toEqual({ authEnabled: false })
  })

  test("si AUTH=on pero falta la configuración de Supabase, responde 503 claro (no deja pasar)", async () => {
    delete process.env.SUPABASE_ANON_KEY
    const r = await get("/api/casos?fecha=2026-09-03", "token-de-a")
    expect(r.status).toBe(503)
    expect(((await r.json()) as { error: string }).error).toContain("inicio de sesión")
  })

  test("el token verificado se cachea (no se llama a Supabase en cada petición)", async () => {
    let llamadas = 0
    _setVerificador(async (t) => (llamadas++, TOKENS[t] ?? null))
    for (let i = 0; i < 4; i++) await get("/api/sessions", "token-de-a")
    expect(llamadas).toBe(1)
    await get("/api/sessions", "token-falso")
    await get("/api/sessions", "token-falso")
    expect(llamadas).toBe(3) // los tokens inválidos no se cachean
  })

  test("sin login (AUTH=off) la app sigue funcionando sin token", async () => {
    process.env.AUTH = "off"
    expect((await get("/api/casos?fecha=2026-09-03")).status).toBe(200)
    const r = await chat(null, { sessionId: "sesion-sin-login-1", message: "procesa co-industrias-delta" })
    expect(r.status).toBe(200)
    expect(((await json<{ sesiones: unknown[] }>(await get("/api/sessions"))).sesiones)).toHaveLength(1)
  })

  test("contra Supabase Auth real, un token falso se rechaza con 401 (omitida sin SUPABASE_URL y SUPABASE_ANON_KEY en .env)", async () => {
    if (!guardado.SUPABASE_URL || !guardado.SUPABASE_ANON_KEY) return
    process.env.SUPABASE_URL = guardado.SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = guardado.SUPABASE_ANON_KEY
    _setVerificador(null) // verificador real
    const r = await get("/api/sessions", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWxzbyJ9.firma-falsa")
    expect(r.status).toBe(401)
  })
})

describe("datos por usuario: aislamiento", () => {
  test("A no ve ni retoma las conversaciones de B (y no se revela que existen)", async () => {
    await chat("token-de-a", { sessionId: "sesion-de-a-0001", message: "procesa co-industrias-delta" })
    await chat("token-de-b", { sessionId: "sesion-de-b-0001", message: "procesa ec-corp-andina" })

    const deA = await json<{ sesiones: { id: string }[] }>(await get("/api/sessions", "token-de-a"))
    const deB = await json<{ sesiones: { id: string }[] }>(await get("/api/sessions", "token-de-b"))
    expect(deA.sesiones.map((s) => s.id)).toEqual(["sesion-de-a-0001"])
    expect(deB.sesiones.map((s) => s.id)).toEqual(["sesion-de-b-0001"])

    // Leer la sesión ajena: 404, igual que una inexistente
    const ajena = await get("/api/sessions/sesion-de-b-0001", "token-de-a")
    const inexistente = await get("/api/sessions/sesion-que-no-existe-1", "token-de-a")
    expect(ajena.status).toBe(404)
    expect(await ajena.text()).toBe(await inexistente.text())
    expect((await get("/api/sessions/sesion-de-a-0001", "token-de-a")).status).toBe(200)

    // Escribir en la sesión ajena: 404, y no se modifica
    const antes = JSON.stringify(await storage.loadSession("sesion-de-b-0001"))
    expect((await chat("token-de-a", { sessionId: "sesion-de-b-0001", message: "hola" })).status).toBe(404)
    expect((await chat("token-de-a", { sessionId: "sesion-de-b-0001", message: "", confirm: true })).status).toBe(404)
    expect(JSON.stringify(await storage.loadSession("sesion-de-b-0001"))).toBe(antes)
    expect((await post("token-de-a", "/api/casos/co-industrias-delta/proponer-envio", { sessionId: "sesion-de-b-0001", fecha: "2026-09-03" })).status).toBe(422)
  })

  const post = (token: string, ruta: string, cuerpo: unknown) => app.request(ruta, { method: "POST", headers: { "content-type": "application/json", ...como(token) }, body: JSON.stringify(cuerpo) })

  test("el dueño sale del token: un `usuarioId` o `userId` en el cuerpo no cambia a quién pertenece", async () => {
    await chat("token-de-a", { sessionId: "sesion-suplanta-1", message: "hola", usuarioId: B.id, userId: B.id })
    expect((await storage.listSessions(A.id)).map((s) => s.id)).toEqual(["sesion-suplanta-1"])
    expect(await storage.listSessions(B.id)).toEqual([])
  })

  test("los logs guardan el id del usuario que ejecutó cada herramienta", async () => {
    await chat("token-de-a", { sessionId: "sesion-logs-a-001", message: "procesa co-industrias-delta" })
    const logs = await storage.readLogs()
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.every((l) => l.userId === A.id)).toBe(true)
    await post("token-de-b", "/api/casos/hn-agroexport-sula/procesar", { fecha: "2026-09-03" })
    expect((await storage.readLogs("hn-agroexport-sula")).every((l) => l.userId === B.id)).toBe(true)
  })

  test("sin login, las sesiones tienen dueño nulo y un usuario con login no las ve", async () => {
    process.env.AUTH = "off"
    await chat(null, { sessionId: "sesion-huerfana-01", message: "hola" })
    process.env.AUTH = "on"
    expect(((await json<{ sesiones: unknown[] }>(await get("/api/sessions", "token-de-a"))).sesiones)).toEqual([])
    expect((await get("/api/sessions/sesion-huerfana-01", "token-de-a")).status).toBe(404)
  })
})

describe("casos y paquetes por usuario: el evaluador empieza limpio", () => {
  const post = (token: string, ruta: string, cuerpo: unknown) => app.request(ruta, { method: "POST", headers: { "content-type": "application/json", ...como(token) }, body: JSON.stringify(cuerpo) })
  const estados = async (token: string) => Object.fromEntries((await json<{ casos: { caso: string; estado: string }[] }>(await get("/api/casos?fecha=2026-09-03", token))).casos.map((c) => [c.caso, c.estado]))

  test("lo que hace A en un caso no cambia la bandeja de B", async () => {
    await post("token-de-a", "/api/casos/co-industrias-delta/procesar", { fecha: "2026-09-03" })
    await post("token-de-a", "/api/casos/ec-corp-andina/procesar", { fecha: "2026-09-03" })
    expect(await estados("token-de-a")).toMatchObject({ "co-industrias-delta": "listo", "ec-corp-andina": "decision", "hn-agroexport-sula": "nuevo" })
    expect(await estados("token-de-b")).toEqual({ "co-industrias-delta": "nuevo", "ec-corp-andina": "nuevo", "hn-agroexport-sula": "nuevo", "pa-logistica-istmo": "nuevo" })
    // y B trabajando el mismo caso no pisa lo de A
    await post("token-de-b", "/api/casos/co-industrias-delta/procesar", { fecha: "2026-09-03" })
    expect((await estados("token-de-b"))["co-industrias-delta"]).toBe("listo")
    expect((await estados("token-de-a"))["ec-corp-andina"]).toBe("decision")
  })

  test("las decisiones, el envío y el costo de un usuario no existen para el otro", async () => {
    await post("token-de-a", "/api/casos/pa-logistica-istmo/procesar", { fecha: "2026-09-03" })
    await post("token-de-a", "/api/casos/pa-logistica-istmo/decisiones", { campo: "RUC", decision: "confirmado", fecha: "2026-09-03" })
    await chat("token-de-a", { sessionId: "sesion-envio-de-a-1", message: "procesa co-industrias-delta" })
    await chat("token-de-a", { sessionId: "sesion-envio-de-a-1", message: "envía" })
    expect((await estados("token-de-a"))["co-industrias-delta"]).toBe("enviado")
    expect((await estados("token-de-a"))["pa-logistica-istmo"]).toBe("listo")
    expect(await estados("token-de-b")).toEqual({ "co-industrias-delta": "nuevo", "ec-corp-andina": "nuevo", "hn-agroexport-sula": "nuevo", "pa-logistica-istmo": "nuevo" })
    const vistaB = await json<{ archivos: string[]; campos: unknown[] }>(await get("/api/casos/co-industrias-delta?fecha=2026-09-03", "token-de-b"))
    expect(vistaB.archivos).toEqual([])
    expect(vistaB.campos).toEqual([])
  })

  test("el resumen de casos es por usuario: lo que procesa A no aparece en la tabla de B", async () => {
    await post("token-de-a", "/api/casos/co-industrias-delta/procesar", { fecha: "2026-09-03" })
    const resumen = async (token: string) => (await json<{ casos: { caso: string; estado: string; camposLlenos: number | null; ultimaActividad: string | null }[] }>(await get("/api/casos/resumen?fecha=2026-09-03", token))).casos
    expect((await resumen("token-de-a")).find((c) => c.caso === "co-industrias-delta")).toMatchObject({ estado: "listo", camposLlenos: 17 })
    const deB = await resumen("token-de-b")
    expect(deB.map((c) => c.estado)).toEqual(["nuevo", "nuevo", "nuevo", "nuevo"])
    expect(deB.every((c) => c.camposLlenos === null && c.ultimaActividad === null)).toBe(true)
    // y el detalle (decisiones) tampoco se filtra entre usuarios
    await post("token-de-a", "/api/casos/pa-logistica-istmo/procesar", { fecha: "2026-09-03" })
    await post("token-de-a", "/api/casos/pa-logistica-istmo/decisiones", { campo: "RUC", decision: "confirmado", fecha: "2026-09-03" })
    const detA = await json<{ decisiones: unknown[] }>(await get("/api/casos/pa-logistica-istmo?fecha=2026-09-03", "token-de-a"))
    const detB = await json<{ decisiones: unknown[] }>(await get("/api/casos/pa-logistica-istmo?fecha=2026-09-03", "token-de-b"))
    expect(detA.decisiones).toHaveLength(1)
    expect(detB.decisiones).toEqual([])
  })

  test("los paquetes se descargan solo desde el espacio de cada usuario (B no puede bajar el de A)", async () => {
    await post("token-de-a", "/api/casos/co-industrias-delta/procesar", { fecha: "2026-09-03" })
    const deA = await get("/api/paquetes/co-industrias-delta/formulario.xlsx", "token-de-a")
    expect(deA.status).toBe(200)
    expect((await deA.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    expect((await get("/api/paquetes/co-industrias-delta/formulario.xlsx", "token-de-b")).status).toBe(404)
    expect((await get("/api/paquetes/co-industrias-delta/paquete/checklist.md", "token-de-b")).status).toBe(404)
    expect(await json(await get("/api/paquetes/co-industrias-delta", "token-de-b"))).toEqual({ caso: "co-industrias-delta", archivos: [] })
    // no hay forma de salirse del espacio propio con la ruta
    for (const ruta of ["/api/paquetes/co-industrias-delta/..%2F..%2Fusuarios%2F" + A.id + "%2Fco-industrias-delta%2Fformulario.xlsx", "/api/paquetes/usuarios/" + A.id]) {
      expect([400, 404]).toContain((await get(ruta, "token-de-b")).status)
    }
  })

  test("los archivos quedan bajo usuarios/<id>/ y no en la raíz compartida", async () => {
    await chat("token-de-a", { sessionId: "sesion-ambito-0001", message: "procesa ec-corp-andina" })
    expect(await storage.exists(`usuarios/${A.id}/ec-corp-andina/paquete/checklist.md`)).toBe(true)
    expect(await storage.exists("ec-corp-andina/paquete/checklist.md")).toBe(false)
    expect(await storage.exists(`usuarios/${B.id}/ec-corp-andina/paquete/checklist.md`)).toBe(false)
  })

  test("el reset borra los espacios de todos los usuarios", async () => {
    process.env.RESET_KEY = "reset-de-prueba"
    await post("token-de-a", "/api/casos/co-industrias-delta/procesar", { fecha: "2026-09-03" })
    const r = await app.request("/api/reset", { method: "POST", headers: { "x-reset-key": "reset-de-prueba", ...como("token-de-a") } })
    expect(r.status).toBe(200)
    expect((await estados("token-de-a"))["co-industrias-delta"]).toBe("nuevo")
    delete process.env.RESET_KEY
  })
})

describe("historial: orden, hora de Colombia y estado", () => {
  test("las más recientes primero", async () => {
    for (const id of ["sesion-orden-0001", "sesion-orden-0002", "sesion-orden-0003"]) {
      await chat("token-de-a", { sessionId: id, message: "hola" })
      await espera(8)
    }
    await chat("token-de-a", { sessionId: "sesion-orden-0001", message: "otra vez" }) // retomar la más vieja la sube
    const l = await json<{ sesiones: { id: string; actualizada: string }[] }>(await get("/api/sessions", "token-de-a"))
    expect(l.sesiones.map((s) => s.id)).toEqual(["sesion-orden-0001", "sesion-orden-0003", "sesion-orden-0002"])
    const fechas = l.sesiones.map((s) => s.actualizada)
    expect([...fechas].sort().reverse()).toEqual(fechas)
  })

  test("la fecha y la hora se muestran en hora de Colombia (UTC-5, sin horario de verano)", () => {
    expect(fechaColombia("2026-11-10T02:30:00.000Z")).toBe("9 nov 2026, 9:30 p. m.")
    expect(fechaColombia("2026-01-15T17:05:00.000Z")).toBe("15 ene 2026, 12:05 p. m.")
    expect(fechaColombia("2026-07-01T05:00:00.000Z")).toBe("1 jul 2026, 12:00 a. m.")
    expect(fechaColombia("2026-12-31T23:59:00.000Z")).toBe("31 dic 2026, 6:59 p. m.")
    expect(fechaColombia("2027-01-01T03:00:00.000Z")).toBe("31 dic 2026, 10:00 p. m.")
  })

  test("estados: en curso, listo, bloqueado e incompleto", async () => {
    const estado = async (id: string) => (await json<{ sesiones: { id: string; estado: string; estadoTexto: string; caso: string | null }[] }>(await get("/api/sessions", "token-de-a"))).sesiones.find((s) => s.id === id)

    // sin caso todavía → en curso
    await chat("token-de-a", { sessionId: "sesion-est-vacia1", message: "hola" })
    expect(await estado("sesion-est-vacia1")).toMatchObject({ estado: "en_curso", estadoTexto: "En curso", caso: null })

    // procesado y esperando tu confirmación → en curso; tras enviar un paquete completo → listo
    const r = await json<{ needsConfirmation: boolean }>(await chat("token-de-a", { sessionId: "sesion-est-listo1", message: "procesa co-industrias-delta" }))
    expect(r.needsConfirmation).toBe(true)
    expect(await estado("sesion-est-listo1")).toMatchObject({ estado: "en_curso", caso: "co-industrias-delta" })
    await chat("token-de-a", { sessionId: "sesion-est-listo1", message: "envía" })
    expect(await estado("sesion-est-listo1")).toMatchObject({ estado: "listo", estadoTexto: "Listo" })

    // paquete que no está listo y la confirmación se cancela → bloqueado
    await chat("token-de-a", { sessionId: "sesion-est-bloq1", message: "procesa ec-corp-andina" })
    expect((await estado("sesion-est-bloq1"))?.estado).toBe("en_curso")
    await chat("token-de-a", { sessionId: "sesion-est-bloq1", message: "mejor no, gracias" })
    expect(await estado("sesion-est-bloq1")).toMatchObject({ estado: "bloqueado", estadoTexto: "Bloqueado", caso: "ec-corp-andina" })

    // el mismo paquete no listo, enviado de todas formas → incompleto
    await chat("token-de-a", { sessionId: "sesion-est-incom1", message: "procesa ec-corp-andina" })
    await chat("token-de-a", { sessionId: "sesion-est-incom1", message: "envía" })
    expect(await estado("sesion-est-incom1")).toMatchObject({ estado: "incompleto", estadoTexto: "Incompleto" })
  })

  test("al abrir una conversación del historial llega completa, con su estado y hora de Colombia", async () => {
    await chat("token-de-a", { sessionId: "sesion-abrir-0001", message: "procesa co-industrias-delta" })
    const s = await json<{ historial: unknown[]; resumen: { estado: string; caso: string }; fechaColombia: string; pendiente: { caso: string } | null }>(await get("/api/sessions/sesion-abrir-0001", "token-de-a"))
    expect(s.historial).toHaveLength(2)
    expect(s.resumen).toEqual({ caso: "co-industrias-delta", estado: "en_curso" })
    expect(s.pendiente?.caso).toBe("co-industrias-delta") // sigue en curso: se puede retomar y confirmar
    expect(s.fechaColombia).toMatch(/^\d{1,2} \p{L}{3} \d{4}, \d{1,2}:\d{2} [ap]\. m\.$/u)
  })
})
