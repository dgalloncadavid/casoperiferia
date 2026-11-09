import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

// Contraste WCAG 2.x calculado sobre los tokens reales de web/styles.css (tema claro y oscuro).
const css = await readFile(path.resolve(import.meta.dirname, "../web/styles.css"), "utf8")

function tokens(bloque: string): Record<string, string> {
  return Object.fromEntries([...bloque.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] as string, m[2] as string]))
}
const inicioOscuro = css.indexOf("@media (prefers-color-scheme: dark)")
const claro = tokens(css.slice(0, inicioOscuro))
const oscuro = { ...claro, ...tokens(css.slice(inicioOscuro, css.indexOf("* { box-sizing")) ) }

const luz = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number)
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** Texto normal: 4.5:1 (AA). */
const TEXTO: [string, string][] = [
  ["texto", "fondo"], ["texto", "superficie"], ["texto", "superficie-2"], ["texto", "acento-suave"], ["texto", "decision-fondo"],
  ["suave", "fondo"], ["suave", "superficie"], ["suave", "superficie-2"], ["suave", "acento-suave"],
  ["acento", "fondo"], ["acento", "superficie"], ["acento", "superficie-2"],
  ["acento-texto", "acento"],
  ["nuevo", "superficie"], ["decision", "superficie"], ["listo", "superficie"], ["enviado", "superficie"], ["rojo", "superficie"],
  ["nuevo", "superficie-2"], ["decision", "superficie-2"], ["listo", "superficie-2"], ["enviado", "superficie-2"], ["rojo", "superficie-2"],
  ["nuevo", "acento-suave"], ["decision", "acento-suave"], ["listo", "acento-suave"], ["enviado", "acento-suave"], ["rojo", "acento-suave"],
  ["decision", "decision-fondo"], ["nuevo", "fondo"], ["rojo", "fondo"], ["listo", "fondo"],
]
/** Componentes de interfaz y foco: 3:1 (AA no textual). */
const NO_TEXTO: [string, string][] = [
  ["borde-control", "superficie"], ["borde-control", "fondo"],
  ["acento", "fondo"], ["acento", "superficie"],
  ["listo", "superficie"], ["decision", "superficie"], ["rojo", "superficie"], ["nuevo", "superficie"],
  ["decision", "decision-fondo"],
]

for (const [tema, paleta] of [["claro", claro], ["oscuro", oscuro]] as const) {
  describe(`contraste AA, tema ${tema}`, () => {
    test("se leyeron los tokens del CSS", () => {
      for (const k of ["fondo", "superficie", "texto", "suave", "acento", "acento-texto", "borde-control", "decision", "listo", "rojo", "enviado", "nuevo"]) expect(paleta[k], `falta --${k}`).toBeDefined()
    })
    test("texto: al menos 4.5:1 en cada par usado", () => {
      const mal = TEXTO.map(([f, b]) => ({ par: `${f} sobre ${b}`, r: ratio(paleta[f] as string, paleta[b] as string) })).filter((x) => x.r < 4.5)
      expect(mal.map((x) => `${x.par}: ${x.r.toFixed(2)}`)).toEqual([])
    })
    test("bordes de controles, foco y semáforo: al menos 3:1", () => {
      const mal = NO_TEXTO.map(([f, b]) => ({ par: `${f} sobre ${b}`, r: ratio(paleta[f] as string, paleta[b] as string) })).filter((x) => x.r < 3)
      expect(mal.map((x) => `${x.par}: ${x.r.toFixed(2)}`)).toEqual([])
    })
  })
}

test("el atributo hidden siempre oculta (si no, las trazabilidades salen abiertas)", () => {
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/)
})

test("el CSS respeta la reducción de movimiento y define el foco visible", () => {
  expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/)
  expect(css).toContain(":focus-visible")
})
