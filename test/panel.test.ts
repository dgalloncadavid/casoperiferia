import { beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { manejarChat } from "../src/agent/ciclo"
import { enmascararCuenta, enmascararTexto } from "../src/core/enmascarar"
import { bandeja, guardarDecision, reporte, vistaCaso } from "../src/core/vista"
import type { DefHerramienta, Mensaje, ProveedorLLM, RespuestaLLM } from "../src/llm/adapter"
import { processCaso } from "../src/process"
import { app, _setDependencias } from "../src/server"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const FECHA = "2026-09-03"
const CUENTA = "03100012345"
let storage: LocalStorage
let n = 0
const ctx = () => ({ directory, sessionId: "panel-test", fechaReferencia: FECHA })

beforeEach(() => {
  storage = new LocalStorage(path.join(directory, "out", `test-panel-${process.pid}-${++n}`))
  setStorage(storage)
  _setDependencias({ directory, storage, llm: null })
  process.env.FECHA_REFERENCIA = FECHA
  delete process.env.RATE_LIMIT_PER_MIN
})

const get = (ruta: string) => app.request(ruta)
const post = (ruta: string, cuerpo: unknown) =>
  app.request(ruta, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify(cuerpo) })
const json = async <T>(r: Response) => (await r.json()) as T

describe("datos bancarios: enmascarados en el chat, completos solo en el formulario", () => {
  test("enmascararCuenta y enmascararTexto (con separadores) conservan solo los últimos 4", () => {
    expect(enmascararCuenta(CUENTA)).toBe("•••• 2345")
    for (const variante of [CUENTA, "0310 0012 345", "0310-0012-345", "031.000.12345"]) {
      expect(enmascararTexto(`Cuenta ${variante}, ok`, [CUENTA])).toBe("Cuenta •••• 2345, ok")
    }
    expect(enmascararTexto("Teléfono 3100012345678", [CUENTA])).toBe("Teléfono 3100012345678") // otro número más largo: no se toca
    expect(enmascararTexto("sin nada", [CUENTA])).toBe("sin nada")
  })

  class Dice implements ProveedorLLM {
    nombre = "falso"
    modelo = "gpt-4.1-mini"
    async enviar(_m: Mensaje[], _h: DefHerramienta[]): Promise<RespuestaLLM> {
      return { proveedor: "falso", modelo: "gpt-4.1-mini", uso: { entrada: 10, salida: 5 }, llamadas: [], texto: `La cuenta es ${CUENTA} (o 0310 0012 345) en Bancolombia.` }
    }
  }

  test("si el modelo escribe la cuenta, el chat, la sesión guardada y la API muestran la versión enmascarada", async () => {
    _setDependencias({ directory, storage, llm: new Dice() })
    const r = await post("/api/chat", { sessionId: "sesion-mascara-01", message: `¿cuál es la cuenta ${CUENTA}?` })
    const j = await json<{ reply: string }>(r)
    expect(j.reply).toContain("•••• 2345")
    expect(j.reply).not.toContain("03100012345")
    expect(j.reply).not.toContain("0310 0012 345")
    const guardada = JSON.stringify(await storage.loadSession("sesion-mascara-01"))
    expect(guardada).not.toMatch(/0310\s?0012\s?345|03100012345/)
    const api = JSON.stringify(await json(await get("/api/sessions/sesion-mascara-01")))
    expect(api).not.toMatch(/0310\s?0012\s?345|03100012345/)
    expect(api).toContain("•••• 2345") // también el mensaje del propio usuario
  })

  test("en el panel del caso el número de cuenta sale enmascarado, pero el formulario descargable lo trae completo", async () => {
    await processCaso("co-industrias-delta", ctx())
    const v = await vistaCaso("co-industrias-delta", ctx(), FECHA)
    if (!v.ok) throw new Error(v.error)
    const cuenta = v.data.campos.find((c) => c.etiqueta === "Número de cuenta")
    expect(cuenta).toMatchObject({ valor: "•••• 2345", enmascarado: true })
    expect(JSON.stringify(v.data)).not.toContain(CUENTA)
    const xlsx = await storage.readFile("co-industrias-delta/formulario.xlsx")
    expect(xlsx).not.toBeNull() // el formulario sí lleva el valor completo (verificado celda a celda por demo.ts)
    const r = await get("/api/casos/co-industrias-delta?fecha=2026-09-03")
    expect(await r.text()).not.toContain(CUENTA)
  })
})

describe("bandeja: estados nuevo, necesita tu decisión, listo para firma, enviado", () => {
  const estados = async (fecha = FECHA) => Object.fromEntries((await bandeja(ctx(), fecha)).map((f) => [f.caso, f.estado]))

  test("sin procesar, todos son «nuevo»", async () => {
    expect(await estados()).toEqual({ "co-industrias-delta": "nuevo", "ec-corp-andina": "nuevo", "hn-agroexport-sula": "nuevo", "pa-logistica-istmo": "nuevo" })
  })

  test("tras procesar: CO listo; EC, HN y PA necesitan tu decisión", async () => {
    for (const c of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) await processCaso(c, ctx())
    expect(await estados()).toEqual({ "co-industrias-delta": "listo", "ec-corp-andina": "decision", "hn-agroexport-sula": "decision", "pa-logistica-istmo": "decision" })
  })

  test("confirmar el único valor pendiente deja el portal listo; en EC sigue pendiente por el soporte que falta", async () => {
    await processCaso("pa-logistica-istmo", ctx())
    await processCaso("ec-corp-andina", ctx())
    expect((await guardarDecision("pa-logistica-istmo", "RUC", "confirmado", ctx())).ok).toBe(true)
    expect((await guardarDecision("ec-corp-andina", "RUC", "confirmado", ctx())).ok).toBe(true)
    const e = await estados()
    expect(e["pa-logistica-istmo"]).toBe("listo")
    expect(e["ec-corp-andina"]).toBe("decision")
    const pa = await vistaCaso("pa-logistica-istmo", ctx(), FECHA)
    expect(pa.ok && pa.data.estadoTexto).toBe("Listo para copiar al portal")
    const ec = await vistaCaso("ec-corp-andina", ctx(), FECHA)
    expect(ec.ok && ec.data.motivos).toEqual(["certificado de cumplimiento tributario: no está en el repositorio"])
  })

  test("«revisar con el cliente» no destraba el caso", async () => {
    await processCaso("pa-logistica-istmo", ctx())
    await guardarDecision("pa-logistica-istmo", "RUC", "revisar", ctx())
    expect((await estados())["pa-logistica-istmo"]).toBe("decision")
  })

  test("tras el envío simulado: «enviado» (y se mantiene aunque cambie la fecha)", async () => {
    await processCaso("co-industrias-delta", ctx())
    const id = "sesion-bandeja-01"
    await manejarChat({ directory, storage, llm: null }, { sessionId: id, message: "procesa co-industrias-delta" })
    await manejarChat({ directory, storage, llm: null }, { sessionId: id, message: "envía" })
    expect((await estados())["co-industrias-delta"]).toBe("enviado")
    expect((await estados("2026-11-09"))["co-industrias-delta"]).toBe("enviado")
  })

  test("la fecha de referencia cambia el estado: con la fecha real la Cámara vencida deja CO en «necesita tu decisión»", async () => {
    await processCaso("co-industrias-delta", ctx())
    expect((await estados("2026-09-03"))["co-industrias-delta"]).toBe("listo")
    expect((await estados("2026-11-09"))["co-industrias-delta"]).toBe("decision")
    const v = await vistaCaso("co-industrias-delta", ctx(), "2026-11-09")
    expect(v.ok && v.data.motivos[0]).toContain("Cámara de Comercio: venció el 2026-09-30")
    expect(v.ok && v.data.paqueteConOtraFecha).toBe("2026-09-03")
  })

  test("las decisiones solo valen para campos realmente por confirmar", async () => {
    await processCaso("ec-corp-andina", ctx())
    expect(await guardarDecision("ec-corp-andina", "Banco", "confirmado", ctx())).toMatchObject({ ok: false, codigo: "campo_invalido" })
    expect(await guardarDecision("ec-corp-andina", "no existe", "confirmado", ctx())).toMatchObject({ ok: false })
  })
})

describe("panel del caso: trazabilidad y soportes", () => {
  test("cada campo dice de dónde sale en el maestro, qué herramienta lo llenó y dónde quedó", async () => {
    await processCaso("co-industrias-delta", ctx())
    const v = await vistaCaso("co-industrias-delta", ctx(), FECHA)
    if (!v.ok) throw new Error(v.error)
    const rep = v.data.campos.find((c) => c.etiqueta === "Representante legal")
    expect(rep).toMatchObject({
      valor: "Roberto Andrade Salazar",
      origen: "Maestro de Periferia › Representante legal › Representante legal",
      destino: "Hoja «Datos Proveedor», celda C11",
      herramienta: { nombre: "Mapeo de campos", tecnico: "proveedor_mapear_campos" },
    })
    expect(rep?.herramienta.cuando).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(v.data.campos.find((c) => c.etiqueta === "Banco")?.origen).toBe("Maestro de Periferia › Datos bancarios › Banco")
  })

  test("soportes con semáforo: vigente verde, por vencer amarillo, vencido y ausente rojo", async () => {
    const co = await vistaCaso("co-industrias-delta", ctx(), FECHA)
    const cam = co.ok && co.data.soportes.find((s) => s.tipo === "camara_comercio")
    expect(cam).toMatchObject({ nombre: "Cámara de Comercio", alerta: "amarilla", diasRestantes: 27 })
    const hn = await vistaCaso("hn-agroexport-sula", ctx(), FECHA)
    expect(hn.ok && hn.data.soportes.find((s) => s.tipo === "parafiscales")).toMatchObject({ estado: "vencido", alerta: "roja", estadoTexto: "Vencido" })
    expect(hn.ok && hn.data.soportes.find((s) => s.tipo === "rut")).toMatchObject({ alerta: "verde" })
    const ec = await vistaCaso("ec-corp-andina", ctx(), FECHA)
    expect(ec.ok && ec.data.soportes.find((s) => s.tipo === "certificado_cumplimiento_tributario")).toMatchObject({ estado: "ausente", alerta: "roja", nombre: "certificado de cumplimiento tributario" })
  })

  test("cada valor por confirmar trae su razón y su regla, en lenguaje de la analista y sin códigos internos", async () => {
    await processCaso("hn-agroexport-sula", ctx())
    const v = await vistaCaso("hn-agroexport-sula", ctx(), FECHA)
    if (!v.ok) throw new Error(v.error)
    const rtn = v.data.campos.find((c) => c.etiqueta === "RTN")
    expect(rtn?.razon).toContain("Periferia solo tiene NIT colombiano")
    expect(rtn?.regla).toContain("siempre se confirma")
    const ing = v.data.campos.find((c) => c.etiqueta === "Ingresos anuales")
    expect(ing).toMatchObject({ valor: "98.000.000.000 COP (2025)" })
    expect(ing?.razon).toContain("pesos colombianos")
    // Lo que ve la analista (no los campos técnicos del JSON) no lleva códigos internos
    const visible = [rtn, ing].flatMap((c) => [c?.razon, c?.regla, c?.nota, c?.origen, c?.destino, c?.herramienta.nombre]).join(" | ")
    expect(visible).not.toMatch(/RN\d|requiere_confirmacion|proveedor_|_/)
  })

  test("un caso nuevo no muestra campos todavía", async () => {
    const v = await vistaCaso("ec-corp-andina", ctx(), FECHA)
    expect(v.ok && v.data.campos).toEqual([])
    expect(v.ok && v.data.estado).toBe("nuevo")
  })
})

describe("costo por caso y reporte entre casos", () => {
  class ConHerramientas implements ProveedorLLM {
    nombre = "falso"
    modelo = "gpt-4.1-mini"
    paso = 0
    async enviar(): Promise<RespuestaLLM> {
      const base = { proveedor: "falso", modelo: "gpt-4.1-mini", uso: { entrada: 1000, salida: 200 } }
      if (this.paso++ === 0) return { ...base, texto: null, llamadas: [{ id: "a", nombre: "proveedor_leer_solicitud", argumentos: JSON.stringify({ caso: "ec-corp-andina" }) }] }
      return { ...base, texto: "Listo.", llamadas: [] }
    }
  }

  test("el gasto de un turno se atribuye al caso que tocó y aparece en el reporte (como estimación)", async () => {
    await manejarChat({ directory, storage, llm: new ConHerramientas() }, { sessionId: "sesion-costo-01", message: "lee ec-corp-andina" })
    const r = await reporte(ctx(), FECHA)
    const ec = r.casos.find((c) => c.caso === "ec-corp-andina")
    expect(ec?.consumo).toMatchObject({ tokensEntrada: 2000, tokensSalida: 400, turnos: 1 })
    expect(ec?.consumo?.costoUsd).toBeCloseTo((2000 * 0.4 + 400 * 1.6) / 1e6, 8)
    expect(r.casos.find((c) => c.caso === "co-industrias-delta")?.consumo).toBeNull()
    expect(r.totalTokens).toBe(2400)
  })

  test("el modo sin modelo y el panel no gastan tokens", async () => {
    await post("/api/casos/co-industrias-delta/procesar", { fecha: FECHA })
    await manejarChat({ directory, storage, llm: null }, { sessionId: "sesion-costo-02", message: "procesa hn-agroexport-sula" })
    const r = await reporte(ctx(), FECHA)
    expect(r.totalCostoUsd).toBe(0)
    expect(r.casos.every((c) => c.consumo === null)).toBe(true)
  })

  test("«Por confirmar» del reporte solo lista lo que sigue pendiente", async () => {
    await processCaso("hn-agroexport-sula", ctx())
    await guardarDecision("hn-agroexport-sula", "RTN", "confirmado", ctx())
    await guardarDecision("hn-agroexport-sula", "Ingresos anuales", "revisar", ctx())
    const hn = (await reporte(ctx(), FECHA)).casos.find((c) => c.caso === "hn-agroexport-sula")
    expect(hn?.porConfirmar).toEqual(["Ingresos anuales"])
  })

  test("el reporte junta lo que falta en todos los casos, por campo, y los soportes por actualizar", async () => {
    const r = await reporte(ctx(), FECHA)
    expect(r.faltantesPorCampo).toEqual([
      { campo: "Número de contribuyente especial", casos: [{ caso: "ec-corp-andina", cliente: "Corporación Andina de Servicios S.A." }] },
      { campo: "Referencias comerciales", casos: [{ caso: "hn-agroexport-sula", cliente: "Agroexport Sula S. de R.L." }] },
    ])
    expect(r.casos.find((c) => c.caso === "ec-corp-andina")?.soportesAActualizar).toEqual(["certificado de cumplimiento tributario (falta)"])
    expect(r.casos.find((c) => c.caso === "hn-agroexport-sula")?.soportesAActualizar).toEqual(["certificado de aportes parafiscales (vencido)"])
    expect(r.casos.find((c) => c.caso === "hn-agroexport-sula")?.porConfirmar).toEqual(["RTN", "Ingresos anuales"])
  })
})

describe("API del panel", () => {
  test("flujo completo: bandeja → procesar → confirmar valor → preparar envío → botón → enviado", async () => {
    const b = await json<{ casos: { caso: string; estado: string }[] }>(await get("/api/casos?fecha=2026-09-03"))
    expect(b.casos.find((c) => c.caso === "co-industrias-delta")?.estado).toBe("nuevo")

    const p = await json<{ caso: { estado: string; campos: unknown[] } }>(await post("/api/casos/co-industrias-delta/procesar", { fecha: FECHA }))
    expect(p.caso.estado).toBe("listo")
    expect(p.caso.campos).toHaveLength(17)

    const prop = await post("/api/casos/co-industrias-delta/proponer-envio", { sessionId: "sesion-panel-01", fecha: FECHA })
    const pj = await json<{ needsConfirmation: boolean; reply: string }>(prop)
    expect(prop.status).toBe(200)
    expect(pj.needsConfirmation).toBe(true)
    expect(pj.reply).toContain("envío simulado")

    const conf = await json<{ toolCalls: { ok: boolean; resumen: string }[] }>(await post("/api/chat", { sessionId: "sesion-panel-01", message: "", confirm: true }))
    expect(conf.toolCalls[0]).toMatchObject({ ok: true, resumen: "envío simulado completo" })
    const v = await json<{ estado: string; archivos: string[] }>(await get("/api/casos/co-industrias-delta?fecha=2026-09-03"))
    expect(v.estado).toBe("enviado")
    expect(v.archivos).toContain("ENVIO-SIMULADO.md")
    expect(v.archivos).not.toContain("estado.json")
  })

  test("decisiones por API: confirmar un valor y rechazar uno inexistente", async () => {
    await post("/api/casos/pa-logistica-istmo/procesar", { fecha: FECHA })
    const ok = await post("/api/casos/pa-logistica-istmo/decisiones", { campo: "RUC", decision: "confirmado", fecha: FECHA })
    expect((await json<{ caso: { estado: string } }>(ok)).caso.estado).toBe("listo")
    expect((await post("/api/casos/pa-logistica-istmo/decisiones", { campo: "Banco", decision: "confirmado" })).status).toBe(422)
    expect((await post("/api/casos/pa-logistica-istmo/decisiones", { campo: "RUC", decision: "tal vez" })).status).toBe(400)
  })

  test("validaciones: fecha inválida, caso inexistente o con nombre peligroso, envío de un portal", async () => {
    expect((await get("/api/casos?fecha=2026-13-45")).status).toBe(400)
    expect((await get("/api/casos/no-existe?fecha=2026-09-03")).status).toBe(404)
    expect((await get("/api/casos/..%2F..%2Fetc")).status).toBe(404)
    expect((await post("/api/chat", { sessionId: "sesion-fecha-01", message: "hola", fecha: "mañana" })).status).toBe(400)
    await post("/api/casos/pa-logistica-istmo/procesar", { fecha: FECHA })
    expect((await post("/api/casos/pa-logistica-istmo/proponer-envio", { sessionId: "sesion-portal-01", fecha: FECHA })).status).toBe(422)
    expect((await post("/api/casos/co-industrias-delta/proponer-envio", { sessionId: "sesion-nuevo-01", fecha: FECHA })).status).toBe(422) // sin procesar
  })

  test("la fecha elegida llega al chat: los soportes se evalúan a esa fecha", async () => {
    const r = await json<{ reply: string; fechaReferencia: string }>(await post("/api/chat", { sessionId: "sesion-fecha-02", message: "procesa co-industrias-delta", fecha: "2026-11-09" }))
    expect(r.fechaReferencia).toBe("2026-11-09")
    expect(r.reply).toContain("Cámara de Comercio: venció el 2026-09-30")
  })

  test("el reporte y la bandeja respetan el límite de peticiones por IP en las acciones", async () => {
    process.env.RATE_LIMIT_PER_MIN = "2"
    expect((await post("/api/casos/co-industrias-delta/procesar", { fecha: FECHA })).status).toBe(200)
    expect((await post("/api/casos/co-industrias-delta/procesar", { fecha: FECHA })).status).toBe(200)
    expect((await post("/api/casos/co-industrias-delta/procesar", { fecha: FECHA })).status).toBe(429)
  })
})
