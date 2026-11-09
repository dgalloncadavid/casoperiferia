// Mide Corp Andina (primer turno del PRD) N veces por proveedor y por la cadena. Escribe docs/comparacion-proveedores.md
// Uso: bun scripts/bench-llm.ts [N=5]
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { manejarChat, type Dependencias } from "../src/agent/ciclo"
import type { ProveedorLLM } from "../src/llm/adapter"
import { CadenaLLM, crearProveedorPorNombre } from "../src/llm/cadena"
import { costoUsd } from "../src/llm/precios"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const N = Number(process.argv[2] ?? 5)
const PROMPT = `Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`
const TOOLS = ["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"]

interface Corrida { ok: boolean; seg: number; tokens: number; costo: number; motivo: string; proveedores: string[]; cambios: string[] }

/** Cambios de proveedor de la cadena durante la corrida en curso. */
let cambiosActuales: string[] = []

async function una(etiqueta: string, llm: ProveedorLLM, i: number): Promise<Corrida> {
  const raiz = path.join(directory, "out", `bench-${etiqueta}-${i}`.replace(/[^A-Za-z0-9_-]/g, "-"))
  const storage = new LocalStorage(raiz)
  await storage.clean()
  setStorage(storage)
  const deps: Dependencias = { directory, storage, llm }
  const id = `bench-${etiqueta}-${i}-${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "-")
  cambiosActuales = []
  const t0 = Date.now()
  const r = await manejarChat(deps, { sessionId: id, message: PROMPT })
  const seg = (Date.now() - t0) / 1000
  const sesion = (await storage.loadSession(id)) as { tokens: number } | null
  const logs = await storage.readLogs()
  const fallos = logs.filter((l) => l.herramienta === "llm_error" || l.herramienta === "llm_failover").map((l) => l.resumen)
  const motivos: string[] = []
  const llamadas = r.toolCalls.map((t) => t.nombre)
  for (const t of TOOLS) if (!llamadas.includes(t)) motivos.push(`no llamó ${t.replace("proveedor_", "")}`)
  if (!r.needsConfirmation) motivos.push("sin confirmación")
  if (!/contribuyente especial/i.test(r.reply)) motivos.push("omite faltante")
  if (!/cumplimiento[ _]tributario/i.test(r.reply)) motivos.push("omite soporte ausente")
  if (!/RUC/.test(r.reply)) motivos.push("omite RUC")
  if (!/\b13\b/.test(r.reply) || /\b14 campos/.test(r.reply)) motivos.push("conteo de llenos ≠ 13")
  if (r.modo !== "modelo") motivos.push(`cayó a ${r.modo}`)
  if (r.reply.startsWith("No pude consultar el modelo")) motivos.push(fallos.at(-1) ?? "error del modelo")
  const tokens = sesion?.tokens ?? 0
  const u = await storage.getUsage(new Date().toISOString().slice(0, 10))
  void u
  return { ok: motivos.length === 0, seg, tokens, costo: 0, motivo: motivos.join("; "), proveedores: [r.proveedor ?? "-"], cambios: [...cambiosActuales] }
}

const filas: string[] = []
const resumen = async (titulo: string, etiqueta: string, llm: ProveedorLLM, modelo: string) => {
  const cs: Corrida[] = []
  for (let i = 1; i <= N; i++) {
    const c = await una(etiqueta, llm, i)
    cs.push(c)
    console.log(`${titulo} #${i}: ${c.ok ? "ok" : "FALLO"} ${c.seg.toFixed(1)} s, ${c.tokens} tokens${c.motivo ? ` — ${c.motivo}` : ""}`)
  }
  const oks = cs.filter((c) => c.ok)
  const tiempos = cs.map((c) => c.seg).sort((a, b) => a - b)
  const med = tiempos[Math.floor(tiempos.length / 2)] ?? 0
  const tok = cs.reduce((s, c) => s + c.tokens, 0) / cs.length
  const motivos = [...new Set(cs.filter((c) => !c.ok).map((c) => c.motivo))].join(" | ") || "—"
  const cambios = cs.flatMap((c) => c.cambios)
  const rescates = cs.filter((c) => c.cambios.length > 0).length
  const detalle = cambios.length ? `${rescates} de ${cs.length} corridas con cambio (${[...new Set(cambios)].join(", ")})` : "—"
  filas.push(`| ${titulo} | ${modelo} | ${oks.length}/${cs.length} | ${tiempos[0]?.toFixed(1)} / ${med.toFixed(1)} / ${tiempos.at(-1)?.toFixed(1)} | ${Math.round(tok)} | ${detalle} | ${motivos} |`)
  void costoUsd
}

const solo = process.argv[3]
for (const nombre of ["openai", "google", "deepseek"].filter(() => solo !== "cadena")) {
  const p = crearProveedorPorNombre(nombre)
  if (p) await resumen(nombre, nombre, p, p.modelo)
}
const todos = ["google", "openai", "deepseek"].map(crearProveedorPorNombre).filter((p): p is ProveedorLLM => p !== null)
if (todos.length === 3) await resumen("cadena google→openai→deepseek", "cadena", new CadenaLLM(todos, (d, c) => cambiosActuales.push(`${d}:${c.tipo}`)), todos.map((p) => p.modelo).join(" → "))

const md = [
  "# Comparación de proveedores: Corp Andina de punta a punta",
  "",
  `Medido el ${new Date().toISOString().slice(0, 10)}: primer turno del PRD §11 (prompt completo) ${N} veces por proveedor, secuencial, sesión nueva en cada corrida, fecha de referencia 2026-09-03.`,
  "",
  "Una corrida cuenta como **éxito** solo si llamó las 4 herramientas, pidió confirmación, mencionó el faltante, el soporte ausente y el RUC por confirmar, y reportó 13 campos llenos. Tiempos: mínimo / mediana / máximo en segundos. Tokens: promedio por corrida (entrada + salida) tal como los reporta el proveedor.",
  "",
  "| Configuración | Modelo | Éxitos | Tiempo (s) mín / med / máx | Tokens | Cambios de proveedor | Motivos de fallo |",
  "|---|---|---|---|---|---|---|",
  ...filas,
  "",
].join("\n")
await mkdir(path.join(directory, "docs"), { recursive: true })
await writeFile(path.join(directory, solo === "cadena" ? "docs/comparacion-cadena.md" : "docs/comparacion-proveedores.md"), md)
console.log("\n" + md)
