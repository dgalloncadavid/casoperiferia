import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import { cargarCaso, cargarRepositorio } from "./fixtures"
import { mapear } from "./mapeo"
import { fail, ok, type CampoMapeado, type Formato, type Result, type ToolContext } from "./types"
import { linea } from "./util"
import { getStorage } from "../storage"

export interface FormularioGenerado {
  ruta: string
  /** Ruta relativa dentro del almacenamiento. */
  rel: string
  formato: Formato
  soportado: boolean
}

export async function mapearCaso(caso: string, ctx: ToolContext) {
  const cargado = await cargarCaso(caso, ctx)
  if (!cargado.ok) return cargado
  if (!cargado.data.plantilla.ok) return cargado.data.plantilla
  const repo = await cargarRepositorio(ctx)
  if (!repo.ok) return repo
  const { solicitud, plantilla, exigidos } = cargado.data
  const campos = mapear(plantilla.data, repo.data.glosario, repo.data.maestro, solicitud.pais)
  return ok({ solicitud, exigidos, campos, repo: repo.data })
}

interface CampoCelda extends CampoMapeado {
  hoja: string
  celda_etiqueta: string
  celda_valor: string
}

function tieneCeldas(c: CampoMapeado): c is CampoCelda {
  return Boolean(c.hoja && c.celda_etiqueta && c.celda_valor)
}

async function generarXlsx(caso: string, campos: CampoMapeado[], ctx: ToolContext): Promise<Result<FormularioGenerado>> {
  const celdas = campos.filter(tieneCeldas)
  if (celdas.length !== campos.length) return fail("plantilla sin hoja o celda de valor", "plantilla_corrupta")
  const wb = new ExcelJS.Workbook()
  wb.creator = "Agente de registro de proveedor"
  for (const c of celdas) {
    const hoja = wb.getWorksheet(c.hoja) ?? wb.addWorksheet(c.hoja)
    for (const ref of [c.celda_etiqueta, c.celda_valor]) hoja.getColumn(ref.replace(/[0-9]/g, "")).width = 42
    const etiqueta = hoja.getCell(c.celda_etiqueta)
    etiqueta.value = c.etiqueta
    etiqueta.font = { bold: true }
    const valor = hoja.getCell(c.celda_valor)
    valor.numFmt = "@" // texto: conserva ceros a la izquierda
    if (c.valor !== undefined) valor.value = c.valor
  }

  const rel = `${caso}/formulario.xlsx`
  await getStorage(ctx.directory).writeFile(rel, new Uint8Array(await wb.xlsx.writeBuffer()))
  const diferencias = await verificarXlsx(rel, celdas, ctx)
  if (diferencias.length > 0) {
    return fail(`la verificación del xlsx falló en ${diferencias.length} celda(s): ${diferencias.join(", ")}`, "verificacion_fallida")
  }
  return ok({ ruta: `out/${rel}`, rel, formato: "xlsx", soportado: true })
}

/** Relee el archivo generado y compara cada celda con el mapeo. Devuelve las celdas que difieren. */
async function verificarXlsx(rel: string, celdas: CampoCelda[], ctx: ToolContext): Promise<string[]> {
  const bytes = await getStorage(ctx.directory).readFile(rel)
  if (!bytes) return ["archivo no encontrado"]
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const malas: string[] = []
  for (const c of celdas) {
    const hoja = wb.getWorksheet(c.hoja)
    const etiqueta = hoja?.getCell(c.celda_etiqueta)
    const valor = hoja?.getCell(c.celda_valor)
    const esperado = c.valor ?? ""
    const leido = valor?.value === null || valor?.value === undefined ? "" : String(valor.value)
    const tipoOk = esperado === "" || valor?.type === ExcelJS.ValueType.String
    if (String(etiqueta?.value ?? "") !== c.etiqueta) malas.push(`${c.hoja}!${c.celda_etiqueta}`)
    if (leido !== esperado || !tipoOk) malas.push(`${c.hoja}!${c.celda_valor}`)
  }
  return malas
}

function textoPdf(fuente: PDFFont, texto: string): string {
  let salida = ""
  for (const ch of linea(texto)) {
    try {
      fuente.encodeText(ch)
      salida += ch
    } catch {
      salida += "?"
    }
  }
  return salida
}

function partir(fuente: PDFFont, texto: string, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tamano) > ancho && actual) {
      lineas.push(actual)
      actual = palabra
    } else actual = prueba
  }
  lineas.push(actual)
  return lineas
}

async function generarPdf(caso: string, cliente: string, campos: CampoMapeado[], ctx: ToolContext): Promise<Result<FormularioGenerado>> {
  const pdf = await PDFDocument.create()
  pdf.setTitle("Formulario de registro de proveedor")
  pdf.setCreationDate(new Date(0))
  pdf.setModificationDate(new Date(0))
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)
  const [ancho, alto, margen] = [595, 842, 50]
  let pagina = pdf.addPage([ancho, alto])
  let y = alto - margen

  const nueva = (necesario: number) => {
    if (y - necesario < margen) {
      pagina = pdf.addPage([ancho, alto])
      y = alto - margen
    }
  }
  const escribir = (t: string, fuente: PDFFont, tam: number, gris = 0) => {
    nueva(tam + 4)
    pagina.drawText(textoPdf(fuente, t), { x: margen, y, size: tam, font: fuente, color: rgb(gris, gris, gris) })
    y -= tam + 4
  }

  escribir("Formulario de registro de proveedor", negrita, 16)
  escribir(`Cliente: ${cliente}`, normal, 10, 0.3)
  y -= 10
  for (const c of campos) {
    escribir(c.etiqueta, negrita, 9, 0.3)
    const lineas = partir(normal, textoPdf(normal, c.valor ?? ""), 11, ancho - 2 * margen)
    for (const l of lineas) escribir(l || " ", normal, 11)
    pagina.drawLine({ start: { x: margen, y: y + 2 }, end: { x: ancho - margen, y: y + 2 }, thickness: 0.4, color: rgb(0.75, 0.75, 0.75) })
    y -= 8
  }
  y -= 20
  nueva(60)
  y -= 40
  pagina.drawLine({ start: { x: margen, y }, end: { x: margen + 220, y }, thickness: 0.8 })
  escribir("Firma del representante legal", normal, 9, 0.3)

  const rel = `${caso}/formulario.pdf`
  await getStorage(ctx.directory).writeFile(rel, await pdf.save())
  return ok({ ruta: `out/${rel}`, rel, formato: "pdf", soportado: true })
}

async function generarPortal(caso: string, cliente: string, campos: CampoMapeado[], ctx: ToolContext): Promise<Result<FormularioGenerado>> {
  const filas = campos.map((c, i) => {
    const valor = c.valor !== undefined ? `\`${c.valor}\`` : "**FALTANTE**: completar a mano"
    const marca = c.estado === "requiere_confirmacion" ? ` ⚠ confirmar${c.nota ? ` (${c.nota})` : ""}` : ""
    return `${i + 1}. **${c.etiqueta}**: ${valor}${marca}`
  })
  const md = [
    `# Valores para el portal de ${linea(cliente)}`,
    "",
    "> Copia cada valor en el formulario en línea, en este orden. El ingreso de credenciales y el clic en «Enviar» los hace una persona.",
    "",
    ...filas,
    "",
  ].join("\n")
  const rel = `${caso}/valores-portal.md`
  await getStorage(ctx.directory).writeFile(rel, md)
  return ok({ ruta: `out/${rel}`, rel, formato: "portal", soportado: false })
}

export async function generarFormulario(caso: string, ctx: ToolContext): Promise<Result<FormularioGenerado>> {
  const m = await mapearCaso(caso, ctx)
  if (!m.ok) return m
  const { solicitud, campos } = m.data
  if (solicitud.formato === "xlsx") return generarXlsx(caso, campos, ctx)
  if (solicitud.formato === "pdf") return generarPdf(caso, solicitud.cliente, campos, ctx)
  return generarPortal(caso, solicitud.cliente, campos, ctx)
}
