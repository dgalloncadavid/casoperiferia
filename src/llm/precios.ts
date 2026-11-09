import type { Uso } from "./adapter"

/** USD por millón de tokens. Referencia aproximada; se sobrescribe con LLM_PRICES='{"modelo":{"in":0.4,"out":1.6}}'. */
const PRECIOS_DEFECTO: Record<string, { in: number; out: number }> = {
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
}
const PRECIO_DESCONOCIDO = { in: 1, out: 4 } // conservador: sobreestima en vez de subestimar

function tabla(): Record<string, { in: number; out: number }> {
  try {
    const extra = process.env.LLM_PRICES ? (JSON.parse(process.env.LLM_PRICES) as Record<string, { in: number; out: number }>) : {}
    return { ...PRECIOS_DEFECTO, ...extra }
  } catch {
    return PRECIOS_DEFECTO
  }
}

export function costoUsd(modelo: string, uso: Uso): number {
  const p = tabla()[modelo] ?? PRECIO_DESCONOCIDO
  return (uso.entrada * p.in + uso.salida * p.out) / 1_000_000
}
