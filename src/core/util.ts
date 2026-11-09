import type { ToolContext } from "./types"

export const FECHA_REFERENCIA_DEFECTO = "2026-09-03"

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

export function fechaValida(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(f)
}

/** Días completos desde `desde` hasta `hasta` (negativo si hasta es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  const ms = new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

export function hoy(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
}

export function resolverFecha(ctx: ToolContext): string | null {
  const f = ctx.fechaReferencia ?? process.env.FECHA_REFERENCIA ?? FECHA_REFERENCIA_DEFECTO
  return fechaValida(f) ? f : null
}

export function agrupar(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function linea(texto: string): string {
  return texto.replace(/[\r\n]+/g, " ").trim()
}
