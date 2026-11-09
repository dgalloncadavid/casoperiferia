import { cargarRepositorio } from "./fixtures"
import type { ToolContext } from "./types"

/** Claves del maestro cuyo valor completo solo debe verse en el formulario. */
const CLAVES_SENSIBLES = new Set(["banco.numero_cuenta"])

export const esSensible = (clave: string | undefined): boolean => clave !== undefined && CLAVES_SENSIBLES.has(clave)

/** «03100012345» → «•••• 2345». */
export function enmascararCuenta(valor: string): string {
  const digitos = valor.replace(/\D/g, "")
  return digitos.length > 4 ? `•••• ${digitos.slice(-4)}` : "••••"
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Sustituye cada aparición de un valor sensible (aun con espacios, puntos o guiones entre dígitos) por su versión enmascarada. */
export function enmascararTexto(texto: string, sensibles: string[]): string {
  let salida = texto
  for (const valor of sensibles) {
    const digitos = valor.replace(/\D/g, "")
    if (digitos.length < 6) continue
    const patron = new RegExp(`(?<!\\d)${[...digitos].map(escapar).join("[\\s.\\-]*")}(?!\\d)`, "g")
    salida = salida.replace(patron, enmascararCuenta(digitos))
  }
  return salida
}

/** Valores completos que no deben aparecer en el chat: hoy, el número de cuenta del maestro. */
export async function valoresSensibles(ctx: ToolContext): Promise<string[]> {
  const repo = await cargarRepositorio(ctx)
  if (!repo.ok) return []
  const banco = repo.data.maestro.banco
  const cuenta = typeof banco === "object" && banco !== null ? (banco as Record<string, unknown>).numero_cuenta : undefined
  return typeof cuenta === "string" ? [cuenta] : []
}
