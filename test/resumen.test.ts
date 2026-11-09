import { beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { guardarDecision, resumenCasos, vistaCaso } from "../src/core/vista"
import { processCaso } from "../src/process"
import { app, _setDependencias } from "../src/server"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const FECHA = "2026-09-03"
let storage: LocalStorage
let n = 0
const ctx = () => ({ directory, sessionId: "resumen-test", fechaReferencia: FECHA })
const CASOS = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]

beforeEach(() => {
  storage = new LocalStorage(path.join(directory, "out", `test-resumen-${process.pid}-${++n}`))
  setStorage(storage)
  _setDependencias({ directory, storage, llm: null })
  process.env.FECHA_REFERENCIA = FECHA
})

const procesarTodos = async () => {
  for (const c of CASOS) await processCaso(c, ctx())
}
const porCaso = async (fecha = FECHA) => Object.fromEntries((await resumenCasos(ctx(), fecha)).map((f) => [f.caso, f]))

describe("una sola fuente de estado", () => {
  test("bandeja, resumen y detalle dicen lo mismo del estado de cada caso, antes y después de procesar y decidir", async () => {
    const comparar = async () => {
      const b = (await (await app.request(`/api/casos?fecha=${FECHA}`)).json()) as { casos: { caso: string; estado: string; estadoTexto: string }[] }
      const r = (await (await app.request(`/api/casos/resumen?fecha=${FECHA}`)).json()) as { casos: { caso: string; estado: string; estadoTexto: string }[] }
      expect(b.casos.map((x) => [x.caso, x.estado, x.estadoTexto])).toEqual(r.casos.map((x) => [x.caso, x.estado, x.estadoTexto]))
      for (const f of r.casos) {
        const d = (await (await app.request(`/api/casos/${f.caso}?fecha=${FECHA}`)).json()) as { estado: string; estadoTexto: string }
        expect([d.estado, d.estadoTexto]).toEqual([f.estado, f.estadoTexto])
      }
      return r.casos
    }
    expect((await comparar()).map((x) => x.estado)).toEqual(["nuevo", "nuevo", "nuevo", "nuevo"])
    await procesarTodos()
    expect((await comparar()).map((x) => x.estado)).toEqual(["listo", "decision", "decision", "decision"])
    await guardarDecision("pa-logistica-istmo", "Ingresos anuales", "confirmado", ctx())
    await comparar()
  })
})

describe("resumen de casos (vista en tabla)", () => {
  test("sin procesar: una fila por caso con lo que se sabe de la solicitud y nada de lo demás", async () => {
    const r = await porCaso()
    expect(Object.keys(r)).toEqual(CASOS)
    expect(r["ec-corp-andina"]).toMatchObject({ cliente: "Corporación Andina de Servicios S.A.", pais: "EC", formato: "pdf", estado: "nuevo", estadoTexto: "Nuevo", procesado: false, camposTotal: 15, camposLlenos: null, porConfirmar: null, ultimaActividad: null, fechaColombia: null })
    expect(r["hn-agroexport-sula"]?.soportesProblema).toEqual({ total: 1, nombres: ["certificado de aportes parafiscales"], vencidos: 1, faltantes: 0 }) // los soportes se evalúan aunque no esté procesado
  })

  test("procesados: campos llenos sobre el total, por confirmar y soportes con problema (fecha del reto)", async () => {
    await procesarTodos()
    const r = await porCaso()
    expect(r["co-industrias-delta"]).toMatchObject({ estado: "listo", camposLlenos: 17, camposTotal: 17, porConfirmar: 0, soportesProblema: { total: 0, nombres: [] } })
    expect(r["ec-corp-andina"]?.soportesProblema).toMatchObject({ vencidos: 0, faltantes: 1 })
    expect(r["ec-corp-andina"]).toMatchObject({ estado: "decision", camposLlenos: 13, camposTotal: 15, porConfirmar: 1, soportesProblema: { total: 1, nombres: ["certificado de cumplimiento tributario"] } })
    expect(r["hn-agroexport-sula"]).toMatchObject({ camposLlenos: 8, camposTotal: 11, porConfirmar: 2, soportesProblema: { total: 1, nombres: ["certificado de aportes parafiscales"] } })
    expect(r["pa-logistica-istmo"]).toMatchObject({ formato: "portal", camposLlenos: 8, camposTotal: 9, porConfirmar: 1, soportesProblema: { total: 0, nombres: [] } })
  })

  test("la última actualización es la hora real de la última actividad, en hora de Colombia", async () => {
    await processCaso("co-industrias-delta", ctx())
    const co = (await porCaso())["co-industrias-delta"]
    expect(co?.ultimaActividad).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(co?.fechaColombia).toMatch(/^\d{1,2} \p{L}{3} \d{4}, \d{1,2}:\d{2} [ap]\. m\.$/u)
    expect(Math.abs(Date.now() - Date.parse(co?.ultimaActividad as string))).toBeLessThan(60_000)
    expect((await porCaso())["ec-corp-andina"]?.ultimaActividad).toBeNull() // otros casos no se tocan
  })

  test("una decisión baja «por confirmar» y adelanta la última actividad", async () => {
    await processCaso("pa-logistica-istmo", ctx())
    const antes = (await porCaso())["pa-logistica-istmo"]
    await new Promise((r) => setTimeout(r, 10))
    await guardarDecision("pa-logistica-istmo", "RUC", "confirmado", ctx())
    const despues = (await porCaso())["pa-logistica-istmo"]
    expect(antes?.porConfirmar).toBe(1)
    expect(despues).toMatchObject({ porConfirmar: 0, estado: "listo" })
    expect(Date.parse(despues?.ultimaActividad as string)).toBeGreaterThan(Date.parse(antes?.ultimaActividad as string))
  })

  test("«revisar con el cliente» no resta de «por confirmar»", async () => {
    await processCaso("hn-agroexport-sula", ctx())
    await guardarDecision("hn-agroexport-sula", "RTN", "revisar", ctx())
    expect((await porCaso())["hn-agroexport-sula"]?.porConfirmar).toBe(2)
  })

  test("la fecha de referencia cambia los soportes con problema y el estado", async () => {
    await processCaso("co-industrias-delta", ctx())
    expect((await porCaso("2026-09-03"))["co-industrias-delta"]).toMatchObject({ estado: "listo", soportesProblema: { total: 0 } })
    expect((await porCaso("2026-11-09"))["co-industrias-delta"]).toMatchObject({ estado: "decision", soportesProblema: { total: 1, nombres: ["Cámara de Comercio"] } })
  })
})

describe("detalle del caso: decisiones con fecha (pestaña «Decisiones»)", () => {
  test("lista lo confirmado y lo mandado a revisar, con valor y fecha en hora de Colombia, la más reciente primero", async () => {
    await processCaso("hn-agroexport-sula", ctx())
    await guardarDecision("hn-agroexport-sula", "RTN", "confirmado", ctx())
    await new Promise((r) => setTimeout(r, 10))
    await guardarDecision("hn-agroexport-sula", "Ingresos anuales", "revisar", ctx())
    const v = await vistaCaso("hn-agroexport-sula", ctx(), FECHA)
    if (!v.ok) throw new Error(v.error)
    expect(v.data.decisiones.map((d) => [d.etiqueta, d.decision, d.valor])).toEqual([
      ["Ingresos anuales", "revisar", "98.000.000.000 COP (2025)"],
      ["RTN", "confirmado", "900123456"],
    ])
    expect(v.data.decisiones.every((d) => /^\d{1,2} \p{L}{3} \d{4}, \d{1,2}:\d{2} [ap]\. m\.$/u.test(d.fechaColombia))).toBe(true)
    expect(v.data.ultimaActividad).not.toBeNull()
  })

  test("sin decisiones la lista viene vacía, y el número de cuenta nunca sale completo", async () => {
    await processCaso("co-industrias-delta", ctx())
    const limpio = await vistaCaso("co-industrias-delta", ctx(), FECHA)
    expect(limpio.ok && limpio.data.decisiones).toEqual([])
    await storage.writeFile("co-industrias-delta/decisiones.json", JSON.stringify({ "Número de cuenta": { decision: "confirmado", ts: new Date().toISOString() } }))
    const v = await vistaCaso("co-industrias-delta", ctx(), FECHA)
    expect(v.ok && v.data.decisiones[0]?.valor).toBe("•••• 2345")
    expect(JSON.stringify(v)).not.toContain("03100012345")
  })
})

describe("GET /api/casos/resumen", () => {
  const get = (r: string) => app.request(r)

  test("responde con la fecha y una fila por caso (y no se confunde con un caso llamado «resumen»)", async () => {
    const r = await get("/api/casos/resumen?fecha=2026-09-03")
    expect(r.status).toBe(200)
    const j = (await r.json()) as { fechaReferencia: string; casos: { caso: string }[] }
    expect(j.fechaReferencia).toBe("2026-09-03")
    expect(j.casos.map((c) => c.caso)).toEqual(CASOS)
    expect((await get("/api/casos/no-existe?fecha=2026-09-03")).status).toBe(404) // el resto de rutas de caso sigue igual
  })

  test("usa la fecha por defecto si no se indica y rechaza una fecha inválida", async () => {
    expect(((await (await get("/api/casos/resumen")).json()) as { fechaReferencia: string }).fechaReferencia).toBe("2026-09-03")
    expect((await get("/api/casos/resumen?fecha=2026-13-45")).status).toBe(400)
    expect((await get("/api/casos/resumen?fecha=mañana")).status).toBe(400)
  })

  test("refleja lo procesado desde la API", async () => {
    await app.request("/api/casos/ec-corp-andina/procesar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fecha: FECHA }) })
    const j = (await (await get("/api/casos/resumen?fecha=2026-09-03")).json()) as { casos: { caso: string; camposLlenos: number | null; estado: string }[] }
    expect(j.casos.find((c) => c.caso === "ec-corp-andina")).toMatchObject({ camposLlenos: 13, estado: "decision" })
    expect(j.casos.find((c) => c.caso === "co-industrias-delta")?.camposLlenos).toBeNull()
  })
})
