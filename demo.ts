// Verificación sin modelo: corre las herramientas sobre los casos y comprueba los resultados esperados.
// Uso: bun demo.ts   (no requiere ninguna clave)
import path from "node:path"
import { processCaso, type ResumenCaso } from "./src/process"
import { herramientas, type ToolContext } from "./src/tools/proveedor"
import { LocalStorage, getStorage, setStorage } from "./src/storage"
import { hoy } from "./src/core/util"
import ExcelJS from "exceljs"

const directory = import.meta.dirname ?? process.cwd()
const FECHA = "2026-09-03"
const base: ToolContext = { directory, sessionId: "demo", fechaReferencia: FECHA }
const test: ToolContext = { ...base, casosRoot: "fixtures-test/casos" }

let fallos = 0
const verde = (s: string) => `\x1b[32m${s}\x1b[0m`
const rojo = (s: string) => `\x1b[31m${s}\x1b[0m`
function check(descripcion: string, cumple: boolean, detalle = ""): void {
  if (!cumple) fallos++
  console.log(`  ${cumple ? verde("✓") : rojo("✗")} ${descripcion}${cumple ? "" : ` ${detalle}`}`)
}
const igual = (a: readonly string[] | undefined, b: readonly string[]) => JSON.stringify(a ?? []) === JSON.stringify(b)
const j = async <T>(p: Promise<string>) => JSON.parse(await p) as { ok: boolean; error?: string; codigo?: string; data?: T; parcial?: { ruta: string } }

interface Esperado {
  caso: string
  campos: number
  porConfirmar: string[]
  faltantes: string[]
  listo: boolean
  estadoFirma: string
  bloqueaPor?: string
}
const ESPERADOS: Esperado[] = [
  { caso: "co-industrias-delta", campos: 17, porConfirmar: [], faltantes: [], listo: true, estadoFirma: "listo" },
  { caso: "ec-corp-andina", campos: 15, porConfirmar: ["RUC"], faltantes: ["Número de contribuyente especial"], listo: false, estadoFirma: "bloqueado", bloqueaPor: "certificado_cumplimiento_tributario" },
  { caso: "hn-agroexport-sula", campos: 11, porConfirmar: ["RTN", "Ingresos anuales"], faltantes: ["Referencias comerciales"], listo: false, estadoFirma: "bloqueado", bloqueaPor: "parafiscales" },
  { caso: "pa-logistica-istmo", campos: 9, porConfirmar: ["RUC"], faltantes: [], listo: false, estadoFirma: "no_aplica" },
]

function imprimirTabla(titulo: string, filas: ResumenCaso[]): void {
  console.log(`\n${titulo}`)
  console.table(
    filas.map((r) => ({
      caso: r.caso,
      campos: r.total_campos ?? "-",
      "por confirmar": (r.por_confirmar ?? []).join(", ") || "—",
      faltantes: (r.faltantes ?? []).join(", ") || "—",
      "listo para firma": r.estado_firma === "no_aplica" ? "no aplica" : r.listo_para_firma ? "sí" : "no",
      alertas: (r.alertas ?? []).length,
    })),
  )
}

async function texto(rel: string): Promise<string> {
  const b = await getStorage(directory).readFile(rel)
  return b ? new TextDecoder().decode(b) : ""
}

async function main(): Promise<void> {
  setStorage(new LocalStorage(path.resolve(directory, "out")))
  await getStorage(directory).clean()
  console.log(`Reto 1 · demo sin modelo · fecha de referencia ${FECHA}`)

  // 1) Los 4 casos de los fixtures
  const resumenes: ResumenCaso[] = []
  for (const e of ESPERADOS) {
    console.log(`\n▸ ${e.caso}`)
    const r = await processCaso(e.caso, base)
    resumenes.push(r)
    check("el proceso terminó sin errores", r.ok, r.avisos.join(" | ") || String(r.error))
    check(`${e.campos} campos`, r.total_campos === e.campos, `(${r.total_campos})`)
    check(`por confirmar: ${e.porConfirmar.join(", ") || "ninguno"}`, igual(r.por_confirmar, e.porConfirmar), JSON.stringify(r.por_confirmar))
    check(`faltantes: ${e.faltantes.join(", ") || "ninguno"}`, igual(r.faltantes, e.faltantes), JSON.stringify(r.faltantes))
    check(`estado de firma: ${e.estadoFirma}`, r.estado_firma === e.estadoFirma && r.listo_para_firma === e.listo, `(${r.estado_firma})`)
    if (e.bloqueaPor) check(`bloquea por ${e.bloqueaPor}`, (r.bloqueadores ?? []).some((b) => b.includes(e.bloqueaPor as string)), JSON.stringify(r.bloqueadores))
    const paquete = await getStorage(directory).list(`${e.caso}/paquete`)
    check("paquete con checklist y borrador de correo", paquete.includes(`${e.caso}/paquete/checklist.md`) && paquete.includes(`${e.caso}/paquete/borrador-correo.md`))
    const correo = await texto(`${e.caso}/paquete/borrador-correo.md`)
    check("el borrador de correo no contiene datos bancarios", !/03100012345|COLOCOBM|Bancolombia/.test(correo))
  }
  const co = resumenes[0] as ResumenCaso
  check("CO: alerta amarilla de Cámara de Comercio (quedan 27 días)", (co.alertas ?? []).some((a) => a.startsWith("camara_comercio") && a.includes("amarilla")), JSON.stringify(co.alertas))
  const ec = resumenes[1] as ResumenCaso
  check("EC: soportes de otro país solo advierten, no bloquean", (ec.advertencias ?? []).length > 0 && !(ec.bloqueadores ?? []).some((b) => b.includes("emitido en")))
  const pa = resumenes[3] as ResumenCaso
  check("PA: genera valores-portal.md", await getStorage(directory).exists("pa-logistica-istmo/valores-portal.md"))
  const portal = await j(herramientas.generar_formulario.execute({ caso: "pa-logistica-istmo" }, base))
  check("PA: generar_formulario responde «formato no soportado»", !portal.ok && /formato no soportado/.test(portal.error ?? "") && portal.parcial?.ruta === pa.formulario, portal.error)

  // 2) Xlsx: ceros a la izquierda y celdas de texto (releído desde el archivo)
  console.log("\n▸ xlsx: ceros a la izquierda")
  const bytes = await getStorage(directory).readFile("co-industrias-delta/formulario.xlsx")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes ?? new Uint8Array()) as unknown as ArrayBuffer)
  const postal = wb.getWorksheet("Datos Proveedor")?.getCell("C8")
  const cuenta = wb.getWorksheet("Datos Bancarios")?.getCell("C5")
  check("código postal «050021» como texto", postal?.value === "050021" && postal.type === ExcelJS.ValueType.String, String(postal?.value))
  check("cuenta «03100012345» como texto", cuenta?.value === "03100012345" && cuenta.type === ExcelJS.ValueType.String, String(cuenta?.value))

  // 3) Argumento `mapeo` ignorado
  console.log("\n▸ el argumento mapeo del modelo se ignora")
  await herramientas.generar_formulario.execute({ caso: "co-industrias-delta", mapeo: { llenos: [{ etiqueta: "Razón social", valor: "VALOR-FALSO" }] } }, base)
  const bytes2 = await getStorage(directory).readFile("co-industrias-delta/formulario.xlsx")
  check("el xlsx no contiene el valor falso", !Buffer.from(bytes2 ?? new Uint8Array()).includes("VALOR-FALSO") && !(await new ExcelJS.Workbook().xlsx.load(Buffer.from(bytes2 ?? new Uint8Array()) as unknown as ArrayBuffer).then((w) => JSON.stringify(w.worksheets.map((s) => s.getCell("C3").value)).includes("VALOR-FALSO"))))

  // 4) Envío simulado: confirmación, idempotencia, incompleto
  console.log("\n▸ envío simulado")
  const sinConf = await j(herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: false }, base))
  check("sin confirmación: «requiere confirmación explícita»", !sinConf.ok && sinConf.error === "requiere confirmación explícita", sinConf.error)
  check("sin confirmación no se escribe ENVIO-SIMULADO.md", !(await getStorage(directory).exists("ec-corp-andina/ENVIO-SIMULADO.md")))
  const e1 = await j<{ incompleto: boolean; existente: boolean; ruta: string }>(herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, base))
  check("EC confirmado: envío marcado INCOMPLETO", e1.ok && e1.data?.incompleto === true && e1.data.existente === false, JSON.stringify(e1))
  const contenido1 = await texto("ec-corp-andina/ENVIO-SIMULADO.md")
  const e2 = await j<{ existente: boolean }>(herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, base))
  check("repetir el envío devuelve el existente (idempotente)", e2.ok && e2.data?.existente === true && (await texto("ec-corp-andina/ENVIO-SIMULADO.md")) === contenido1)
  const e3 = await j<{ incompleto: boolean }>(herramientas.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, base))
  check("CO confirmado: envío COMPLETO", e3.ok && e3.data?.incompleto === false)
  const e4 = await j(herramientas.simular_envio.execute({ caso: "pa-logistica-istmo", confirmado: true }, base))
  check("PA: el portal no se «envía»", !e4.ok && e4.codigo === "formato_no_soportado", e4.error)

  // 5) Casos de error
  console.log("\n▸ errores")
  const noExiste = await j(herramientas.leer_solicitud.execute({ caso: "no-existe" }, base))
  check("caso inexistente: error claro", !noExiste.ok && noExiste.codigo === "caso_no_encontrado", noExiste.error)
  for (const malo of ["../../etc", "CO_Delta", "co/delta", ""]) {
    const r = await j(herramientas.leer_solicitud.execute({ caso: malo }, base))
    check(`caso inválido «${malo}» rechazado`, !r.ok)
  }
  const sinArgs = await j(herramientas.leer_solicitud.execute({} as { caso: string }, base))
  check("argumentos inválidos devuelven error, no excepción", !sinArgs.ok && sinArgs.codigo === "argumentos_invalidos")
  const corrupta = await j(herramientas.leer_solicitud.execute({ caso: "err-plantilla-corrupta" }, test))
  check("plantilla corrupta: mensaje claro sin traza", !corrupta.ok && corrupta.codigo === "plantilla_corrupta" && !/\bat \w|node_modules|SyntaxError/.test(corrupta.error ?? ""), corrupta.error)
  const rc = await processCaso("err-plantilla-corrupta", test)
  check("plantilla corrupta: continúa con soportes y checklist", (await getStorage(directory).exists("err-plantilla-corrupta/paquete/checklist.md")) && rc.listo_para_firma === false, JSON.stringify(rc.avisos))
  console.log("\n▸ inyección de instrucciones en el cuerpo del correo")
  const ri = await processCaso("err-inyeccion", test)
  check("el resultado es idéntico al del caso limpio", ri.total_campos === 17 && ri.faltantes?.length === 0 && ri.listo_para_firma === true)
  const correoInj = await texto("err-inyeccion/paquete/borrador-correo.md")
  check("el borrador no copia el texto inyectado ni la cuenta", !/evil|atacante|aprobado/i.test(correoInj) && !/03100012345/.test(correoInj))
  check("no se envió nada por la inyección", !(await getStorage(directory).exists("err-inyeccion/ENVIO-SIMULADO.md")))

  // 5b) Etiqueta ambigua (HU-1) y faltantes que no bloquean (RN3)
  console.log("\n▸ etiqueta ambigua «Identificación tributaria» (HU-1)")
  const amb = await j<{ campos: { etiqueta: string; requiere_confirmacion?: boolean; equivalente_propuesto?: string }[] }>(herramientas.leer_solicitud.execute({ caso: "ambiguo-identificacion" }, test))
  const campoAmb = amb.data?.campos.find((c) => c.etiqueta === "Identificación tributaria")
  check("leer_solicitud la marca requiere_confirmacion y propone RUC (Ecuador)", campoAmb?.requiere_confirmacion === true && campoAmb.equivalente_propuesto === "RUC", JSON.stringify(campoAmb))
  const ambMap = await j<{ requiere_confirmacion: { etiqueta: string; confianza: number }[]; faltantes: { etiqueta: string }[]; llenos: { etiqueta: string; confianza: number }[] }>(herramientas.mapear_campos.execute({ caso: "ambiguo-identificacion" }, test))
  check("mapear_campos la deja por confirmar con confianza 0.7", ambMap.data?.requiere_confirmacion.some((c) => c.etiqueta === "Identificación tributaria" && c.confianza === 0.7) === true)
  check("«telefono» (sin tilde) se resuelve con confianza 0.9", ambMap.data?.llenos.some((c) => c.etiqueta === "telefono" && c.confianza === 0.9) === true)
  check("una etiqueta sin parecido queda faltante, no inventada", ambMap.data?.faltantes.some((c) => c.etiqueta === "Sitio favorito del gerente") === true)
  const ecR = resumenes[1] as ResumenCaso
  const hnR = resumenes[2] as ResumenCaso
  check("los campos faltantes no figuran entre los bloqueadores de la firma", ![...(ecR.bloqueadores ?? []), ...(hnR.bloqueadores ?? [])].some((b) => /contribuyente|referencias/i.test(b)))

  // 6) Logs
  console.log("\n▸ logs")
  const logGlobal = await getStorage(directory).readLogs()
  const logCaso = await getStorage(directory).readLogs("ec-corp-andina")
  check("out/log.jsonl y out/<caso>/log.jsonl con {ts, herramienta, ok, resumen}", logGlobal.length > 0 && logCaso.length > 0 && logCaso.every((l) => l.ts && l.herramienta && typeof l.ok === "boolean" && l.resumen))
  const crudo = await texto("log.jsonl")
  check("los logs no contienen datos bancarios", !/03100012345|COLOCOBM|900123456/.test(crudo))

  imprimirTabla(`Resumen · fecha de referencia ${FECHA}`, resumenes)

  // 7) Corrida con la fecha real (fuera de out/ para no pisar lo anterior)
  const real = hoy()
  setStorage(new LocalStorage(path.resolve(directory, "out/fecha-real")))
  const realCtx: ToolContext = { ...base, fechaReferencia: real }
  const reales: ResumenCaso[] = []
  for (const e of ESPERADOS) reales.push(await processCaso(e.caso, realCtx))
  imprimirTabla(`Corrida con la fecha real (${real}): los soportes vencidos bloquean los paquetes`, reales)
  for (const r of reales) console.log(`  ${r.caso}: ${(r.bloqueadores ?? []).join(" · ") || "sin bloqueadores"}`)

  console.log(fallos === 0 ? verde("\nTODAS LAS VERIFICACIONES PASARON") : rojo(`\n${fallos} VERIFICACIÓN(ES) FALLARON`))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error("demo falló:", e instanceof Error ? e.message : e)
  process.exit(1)
})
