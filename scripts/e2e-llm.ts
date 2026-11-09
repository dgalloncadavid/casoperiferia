// Corp Andina de punta a punta, con cada proveedor y en modo sin modelo. Guarda las transcripciones.
// Uso: bun scripts/e2e-llm.ts            → openai, google, deepseek y sin modelo (según las claves que haya en .env)
//      bun scripts/e2e-llm.ts google     → solo ese proveedor
//      bun scripts/e2e-llm.ts sin-modelo → solo modo sin modelo
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { manejarChat, type Dependencias } from "../src/agent/ciclo"
import { crearProveedorPorNombre } from "../src/llm/cadena"
import { LocalStorage, setStorage } from "../src/storage"
import type { ProveedorLLM } from "../src/llm/adapter"

const directory = path.resolve(import.meta.dirname, "..")
const PROMPT = `Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`

async function correr(etiqueta: string, llm: ProveedorLLM | null): Promise<boolean> {
  const storage = new LocalStorage(path.join(directory, "out", `e2e-${etiqueta}`.replace(/[^A-Za-z0-9_-]/g, "-")))
  await storage.clean()
  setStorage(storage)
  const deps: Dependencias = { directory, storage, llm }
  const id = `e2e-${etiqueta}-${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "-")
  const lineas: string[] = [`# Transcripción: Corp Andina de punta a punta (${etiqueta})`, "", `Fecha de referencia: ${process.env.FECHA_REFERENCIA ?? "2026-09-03"}`, ""]
  const fallos: string[] = []

  const turno = async (mensaje: string, confirm = false) => {
    const t0 = Date.now()
    const r = await manejarChat(deps, { sessionId: id, message: mensaje, confirm })
    lineas.push(`## Usuario\n\n${confirm ? "[Botón] Confirmar envío" : mensaje}\n`)
    for (const t of r.toolCalls) lineas.push(`- \`${t.nombre}\` ${JSON.stringify(t.args)} → ${t.ok ? "ok" : "error"}: ${t.resumen}`)
    lineas.push("", `## Asistente (${r.modo}${r.proveedor ? `, ${r.proveedor}/${r.modelo}` : ""}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`, "")
    if (r.aviso) lineas.push(`> Aviso: ${r.aviso}`, "")
    lineas.push(r.reply, "", `needsConfirmation: ${r.needsConfirmation}`, "")
    return r
  }

  const afirmar = (cond: boolean, msg: string) => cond || fallos.push(msg)
  const r1 = await turno(PROMPT)
  const nombres = r1.toolCalls.map((t) => t.nombre)
  const esperadas = llm ? ["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"] : ["processCaso"]
  for (const e of esperadas) afirmar(nombres.includes(e), `no llamó ${e}`)
  afirmar(r1.needsConfirmation, "no pidió confirmación")
  afirmar(!(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md")), "envió sin confirmar")
  afirmar(/contribuyente especial/i.test(r1.reply), "la respuesta no menciona el campo faltante (contribuyente especial)")
  afirmar(/cumplimiento[ _]tributario/i.test(r1.reply), "la respuesta no menciona el soporte faltante")
  afirmar(/\b13\b/.test(r1.reply) && !/\b14 campos/.test(r1.reply), "el conteo de llenos no es 13")
  afirmar(/RUC/.test(r1.reply), "la respuesta no menciona el RUC por confirmar")
  afirmar(!/03100012345|COLOCOBM/.test(r1.reply), "el chat repitió datos bancarios sin que se pidieran")

  await turno("envía")
  afirmar(await storage.exists("ec-corp-andina/ENVIO-SIMULADO.md"), "«envía» no produjo ENVIO-SIMULADO.md")
  afirmar((await storage.list("ec-corp-andina")).filter((a) => a.endsWith("ENVIO-SIMULADO.md")).length === 1, "ENVIO-SIMULADO.md duplicado")

  lineas.push("---", fallos.length ? `FALLOS: ${fallos.join("; ")}` : "Todas las verificaciones pasaron.", "")
  await mkdir(path.join(directory, "docs/transcripciones"), { recursive: true })
  const archivo = path.join(directory, "docs/transcripciones", `paso2-corp-andina-${etiqueta}.md`)
  await writeFile(archivo, lineas.join("\n"))
  console.log(`${fallos.length ? "✗" : "✓"} ${etiqueta}: ${fallos.length ? fallos.join("; ") : "ok"} → ${path.relative(directory, archivo)}`)
  return fallos.length === 0
}

const filtro = process.argv[2]
const soloSinModelo = filtro === "sin-modelo"
let todoOk = true
if (!soloSinModelo) {
  for (const nombre of ["openai", "google", "deepseek"].filter((n) => !filtro || n === filtro)) {
    const p = crearProveedorPorNombre(nombre)
    if (!p) console.log(`- ${nombre}: sin clave en .env → omitido`)
    else todoOk = (await correr(`${nombre}-${p.modelo}`, p).catch((e: unknown) => (console.log(`✗ ${nombre}: ${e instanceof Error ? e.message : e}`), false))) && todoOk
  }
}
if (!filtro || soloSinModelo) todoOk = (await correr("sin-modelo", null)) && todoOk
process.exit(todoOk ? 0 : 1)
