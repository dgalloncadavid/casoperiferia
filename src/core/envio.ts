import { getStorage } from "../storage"
import { resolverCaso } from "./fixtures"
import type { EstadoCaso } from "./paquete"
import { fail, ok, type Result, type ToolContext } from "./types"

export interface EnvioData {
  ruta: string
  incompleto: boolean
  existente: boolean
}

export async function simularEnvio(caso: string, confirmado: boolean, ctx: ToolContext): Promise<Result<EnvioData>> {
  if (confirmado !== true) return fail("requiere confirmación explícita", "requiere_confirmacion")
  const dir = await resolverCaso(caso, ctx)
  if (!dir.ok) return dir
  const storage = getStorage(ctx.directory)

  const bytes = await storage.readFile(`${caso}/estado.json`)
  if (!bytes) return fail("el paquete aún no está armado: ejecute proveedor_armar_paquete primero", "paquete_no_armado")
  const estado = JSON.parse(new TextDecoder().decode(bytes)) as EstadoCaso
  if (estado.estado_firma === "no_aplica") {
    return fail("formato portal: el alta la hace una persona en el portal; no hay envío que simular", "formato_no_soportado")
  }

  const rel = `${caso}/ENVIO-SIMULADO.md`
  const ruta = `out/${rel}`
  const incompleto = !estado.listo_para_firma
  if (await storage.exists(rel)) return ok({ ruta, incompleto, existente: true })

  const archivos = (await storage.list(`${caso}/paquete`)).map((a) => a.slice(caso.length + 1))
  const md = [
    "# ENVÍO SIMULADO",
    "",
    "> No se envió nada. Este archivo solo deja constancia de la confirmación del usuario.",
    "",
    `- **Caso:** ${caso}`,
    `- **Registrado:** ${new Date().toISOString()}`,
    `- **Fecha de referencia de los soportes:** ${estado.fecha_referencia}`,
    `- **Estado del paquete:** ${incompleto ? "INCOMPLETO" : "COMPLETO"}`,
    ...(incompleto ? ["", "## Pendientes al momento del envío", ...estado.bloqueadores.map((b) => `- ${b}`)] : []),
    "",
    "## Contenido del paquete",
    ...archivos.map((a) => `- ${a}`),
    "",
  ].join("\n")
  await storage.writeFile(rel, md)
  return ok({ ruta, incompleto, existente: false })
}
