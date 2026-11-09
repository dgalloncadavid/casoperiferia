import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { fail, ok, type CampoPlantilla, type Result, type Solicitud, type ToolContext } from "./types"

export const CASO_RE = /^[a-z0-9-]+$/
const RAIZ_FIXTURES = "fixtures/reto-01"
const RAICES_PERMITIDAS = ["fixtures", "fixtures-test"]

const solicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  adjuntos: z.array(z.string()),
})
const celdasSchema = z.array(
  z.object({
    hoja: z.string().min(1),
    celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/),
    etiqueta: z.string().min(1),
    celda_valor: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/),
  }),
)
const camposSchema = z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() }))
const exigidosSchema = z.array(z.string())
const glosarioSchema = z.record(z.string(), z.string())
const maestroSchema = z.record(z.string(), z.unknown())
const indexSchema = z.array(
  z.object({
    tipo: z.string(),
    archivo: z.string(),
    vigencia_hasta: z.string().nullable(),
    pais_emisor: z.string(),
    descripcion: z.string().optional(),
  }),
)
export type IndiceSoportes = z.infer<typeof indexSchema>

export interface CasoCargado {
  solicitud: Solicitud
  exigidos: string[]
  /** Error en vez de datos si la plantilla falta o está corrupta. */
  plantilla: Result<CampoPlantilla[]>
}

export interface Repositorio {
  maestro: Record<string, unknown>
  glosario: Record<string, string>
  soportes: IndiceSoportes
  dirSoportes: string
}

async function leerJson<T>(archivo: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(archivo, "utf8")))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function dentroDe(base: string, destino: string): boolean {
  return destino === base || destino.startsWith(base + path.sep)
}

export async function resolverCaso(caso: string, ctx: ToolContext): Promise<Result<string>> {
  if (!CASO_RE.test(caso) || caso.length > 64) {
    return fail("nombre de caso inválido: solo minúsculas, números y guiones", "caso_invalido")
  }
  const raiz = path.resolve(ctx.directory, ctx.casosRoot ?? `${RAIZ_FIXTURES}/casos`)
  const permitido = RAICES_PERMITIDAS.some((r) => dentroDe(path.resolve(ctx.directory, r), raiz))
  if (!permitido) return fail("la carpeta de casos debe estar dentro de fixtures/", "caso_invalido")
  const dir = path.resolve(raiz, caso)
  if (!dentroDe(raiz, dir) || dir === raiz) return fail("ruta de caso fuera de fixtures/", "caso_invalido")
  const info = await stat(dir).catch(() => null)
  if (!info?.isDirectory()) return fail(`caso no encontrado: ${caso}`, "caso_no_encontrado")
  return ok(dir)
}

export async function cargarCaso(caso: string, ctx: ToolContext): Promise<Result<CasoCargado>> {
  const dir = await resolverCaso(caso, ctx)
  if (!dir.ok) return dir
  const solicitud = await leerJson(path.join(dir.data, "solicitud.json"), solicitudSchema)
  if (!solicitud) return fail("solicitud.json ausente o con formato inválido", "solicitud_invalida")
  const exigidos = await leerJson(path.join(dir.data, "soportes-exigidos.json"), exigidosSchema)
  if (!exigidos) return fail("soportes-exigidos.json ausente o con formato inválido", "solicitud_invalida")

  const archivo = solicitud.formato === "xlsx" ? "plantilla-celdas.json" : "plantilla-campos.json"
  const schema = solicitud.formato === "xlsx" ? celdasSchema : camposSchema
  const campos = await leerJson<CampoPlantilla[]>(path.join(dir.data, archivo), schema)
  const plantilla: Result<CampoPlantilla[]> = campos
    ? ok(campos)
    : fail(`plantilla corrupta o ausente (${archivo}): no se pueden leer los campos`, "plantilla_corrupta")
  return ok({ solicitud, exigidos, plantilla })
}

export async function cargarRepositorio(ctx: ToolContext): Promise<Result<Repositorio>> {
  const base = path.resolve(ctx.directory, RAIZ_FIXTURES)
  const maestro = await leerJson(path.join(base, "repositorio/maestro.json"), maestroSchema)
  const glosario = await leerJson(path.join(base, "glosario-campos.json"), glosarioSchema)
  const soportes = await leerJson(path.join(base, "repositorio/soportes/index.json"), indexSchema)
  if (!maestro || !glosario || !soportes) {
    return fail("repositorio maestro, glosario o índice de soportes ilegible", "repositorio_ilegible")
  }
  return ok({ maestro, glosario, soportes, dirSoportes: path.join(base, "repositorio/soportes") })
}

/** Nombres de los casos disponibles (carpetas válidas bajo la raíz de casos). */
export async function listarCasos(ctx: ToolContext): Promise<string[]> {
  const raiz = path.resolve(ctx.directory, ctx.casosRoot ?? `${RAIZ_FIXTURES}/casos`)
  const entradas = await readdir(raiz, { withFileTypes: true }).catch(() => [])
  return entradas
    .filter((e) => e.isDirectory() && CASO_RE.test(e.name))
    .map((e) => e.name)
    .sort()
}
