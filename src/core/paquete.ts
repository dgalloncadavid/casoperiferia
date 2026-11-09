import { readFile } from "node:fs/promises"
import path from "node:path"
import { getStorage } from "../storage"
import { cargarCaso, cargarRepositorio } from "./fixtures"
import { generarFormulario } from "./formulario"
import { mapear } from "./mapeo"
import { describirSoporte, evaluarSoportes } from "./soportes"
import { fail, ok, type CampoMapeado, type Result, type SoporteEval, type ToolContext } from "./types"
import { linea, resolverFecha } from "./util"

export type EstadoFirma = "listo" | "bloqueado" | "no_aplica"

export interface Checklist {
  fecha_referencia: string
  estado_firma: EstadoFirma
  bloqueadores: string[]
  alertas: string[]
  advertencias: string[]
  soportes: SoporteEval[]
  campos_por_confirmar: string[]
  campos_faltantes: string[]
}

export interface PaqueteData {
  ruta: string
  listo_para_firma: boolean
  estado_firma: EstadoFirma
  checklist: Checklist
}

export interface EstadoCaso {
  listo_para_firma: boolean
  estado_firma: EstadoFirma
  bloqueadores: string[]
  fecha_referencia: string
}

const ICONO = { verde: "🟢", amarilla: "🟡", roja: "🔴" } as const

function construirChecklist(c: Checklist): string {
  const filas = c.soportes.map((s) => {
    const vig = s.vigencia_hasta ?? "sin vencimiento"
    const dias = s.dias_restantes === null ? "-" : String(s.dias_restantes)
    return `| ${s.tipo} | ${s.estado} | ${vig} | ${dias} | ${ICONO[s.alerta]} ${s.alerta} | ${s.advertencia ?? ""} |`
  })
  const lista = (xs: string[], vacio: string) => (xs.length ? xs.map((x) => `- ${x}`) : [`- ${vacio}`])
  return [
    "# Checklist del paquete para firma",
    "",
    `- **Fecha de referencia:** ${c.fecha_referencia}`,
    `- **Estado:** ${{ listo: "LISTO PARA FIRMA", bloqueado: "BLOQUEADO (no está listo para firma)", no_aplica: "NO APLICA (portal: lo hace una persona)" }[c.estado_firma]}`,
    "",
    "## Bloqueadores",
    ...lista(c.bloqueadores, "ninguno"),
    "",
    "## Soportes",
    "| Soporte | Estado | Vigencia hasta | Días | Alerta | Advertencia |",
    "|---|---|---|---|---|---|",
    ...filas,
    "",
    "## Campos por confirmar",
    ...lista(c.campos_por_confirmar, "ninguno"),
    "",
    "## Campos faltantes (no bloquean la firma)",
    ...lista(c.campos_faltantes, "ninguno"),
    "",
  ].join("\n")
}

function construirCorreo(
  razonSocial: string,
  solicitud: { de: string; asunto: string; cliente: string },
  adjuntos: string[],
  bloqueadores: string[],
): string {
  const aviso = bloqueadores.length
    ? [`> ⚠ NOTA INTERNA (borrar antes de enviar): el paquete NO está listo para firma.`, ...bloqueadores.map((b) => `> - ${b}`), ""]
    : []
  return [
    "> Borrador generado por el agente. No se ha enviado. Requiere revisión y firma del representante legal.",
    ...aviso,
    `**Para:** ${linea(solicitud.de)}`,
    `**Asunto:** Re: ${linea(solicitud.asunto)}`,
    "",
    "Buenos días,",
    "",
    `Adjuntamos el formulario diligenciado y los soportes solicitados para el registro de ${razonSocial} como proveedor de ${linea(solicitud.cliente)}.`,
    "",
    "**Adjuntos:**",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier observación.",
    "",
    "Cordialmente,",
    `Área administrativa — ${razonSocial}`,
    "",
  ].join("\n")
}

export async function armarPaquete(caso: string, ctx: ToolContext): Promise<Result<PaqueteData>> {
  const cargado = await cargarCaso(caso, ctx)
  if (!cargado.ok) return cargado
  const fecha = resolverFecha(ctx)
  if (!fecha) return fail("FECHA_REFERENCIA inválida: use AAAA-MM-DD", "fecha_invalida")
  const repo = await cargarRepositorio(ctx)
  if (!repo.ok) return repo
  const { solicitud, exigidos, plantilla } = cargado.data
  const storage = getStorage(ctx.directory)
  const bloqueadores: string[] = []

  const soportes = await evaluarSoportes(exigidos, repo.data.soportes, repo.data.dirSoportes, solicitud.pais, fecha)
  for (const s of soportes) {
    if (s.estado === "ausente") bloqueadores.push(`Soporte ausente: ${s.tipo}`)
    if (s.estado === "vencido") bloqueadores.push(`Soporte vencido: ${describirSoporte(s)}`)
  }

  let campos: CampoMapeado[] = []
  if (plantilla.ok) {
    campos = mapear(plantilla.data, repo.data.glosario, repo.data.maestro, solicitud.pais)
  } else {
    bloqueadores.push(`Plantilla ilegible: ${plantilla.error}`)
  }

  const adjuntos: string[] = []
  const form = plantilla.ok ? await generarFormulario(caso, ctx) : null
  if (form?.ok) {
    const bytes = await storage.readFile(form.data.rel)
    const nombre = form.data.rel.split("/").pop() as string
    if (bytes) {
      await storage.writeFile(`${caso}/paquete/${nombre}`, bytes)
      adjuntos.push(nombre)
    }
  } else if (form) {
    bloqueadores.push(`Formulario no generado: ${form.error}`)
  }

  for (const s of soportes) {
    if (!s.archivo) continue
    const bytes = new Uint8Array(await readFile(path.join(repo.data.dirSoportes, s.archivo)))
    await storage.writeFile(`${caso}/paquete/soportes/${s.archivo}`, bytes)
    adjuntos.push(`soportes/${s.archivo}`)
  }

  const esPortal = solicitud.formato === "portal"
  const estado: EstadoFirma = esPortal ? "no_aplica" : bloqueadores.length === 0 ? "listo" : "bloqueado"
  const checklist: Checklist = {
    fecha_referencia: fecha,
    estado_firma: estado,
    bloqueadores,
    alertas: soportes.filter((s) => s.estado === "vigente" && s.alerta !== "verde").map((s) => `${describirSoporte(s)} [${s.alerta}]`),
    advertencias: soportes.filter((s) => s.advertencia).map((s) => `${s.tipo}: ${s.advertencia}`),
    soportes,
    campos_por_confirmar: campos.filter((c) => c.estado === "requiere_confirmacion").map((c) => c.etiqueta),
    campos_faltantes: campos.filter((c) => c.estado === "faltante").map((c) => c.etiqueta),
  }

  const razon = typeof repo.data.maestro.razon_social === "string" ? repo.data.maestro.razon_social : "Periferia IT Group S.A.S."
  await storage.writeFile(`${caso}/paquete/checklist.md`, construirChecklist(checklist))
  await storage.writeFile(`${caso}/paquete/borrador-correo.md`, construirCorreo(razon, solicitud, adjuntos, estado === "no_aplica" ? [] : bloqueadores))
  const estadoCaso: EstadoCaso = { listo_para_firma: estado === "listo", estado_firma: estado, bloqueadores, fecha_referencia: fecha }
  await storage.writeFile(`${caso}/estado.json`, JSON.stringify(estadoCaso, null, 2))

  return ok({ ruta: `out/${caso}/paquete/`, listo_para_firma: estado === "listo", estado_firma: estado, checklist })
}
