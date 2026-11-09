import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

// Contraste WCAG 2.x y reglas del sistema visual, calculados sobre web/styles.css (tema claro y oscuro).
const css = await readFile(path.resolve(import.meta.dirname, "../web/styles.css"), "utf8")

const inicioOscuro = css.indexOf("@media (prefers-color-scheme: dark)")
const finOscuro = css.indexOf("/* ---------- Base")
const bloqueClaro = css.slice(css.indexOf(":root {"), inicioOscuro)
const bloqueOscuro = css.slice(inicioOscuro, finOscuro)
const resto = css.slice(finOscuro) // todo lo que NO son tokens

function tokens(bloque: string): Record<string, string> {
  return Object.fromEntries([...bloque.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] as string, m[2] as string]))
}
const claro = tokens(bloqueClaro)
const oscuro = { ...claro, ...tokens(bloqueOscuro) }

const luz = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number)
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

const FONDOS = ["canvas", "paper", "muted-card", "hover", "sel-bg"]
const ESTADOS = ["txt-nuevo", "txt-decision", "txt-listo", "txt-enviado", "txt-bloqueado"]
/** Texto normal: 4.5:1 (AA), en cada fondo donde se usa. */
const TEXTO: [string, string][] = [
  ...["ink", "charcoal", "steel", "fog-text", ...ESTADOS].flatMap((t) => FONDOS.map((f) => [t, f] as [string, string])),
  ...["canvas", "paper", "muted-card"].map((f) => ["blue-text", f] as [string, string]),
  ["sel-ink", "sel-bg"],
  ["primary-ink", "primary-bg"],
]
/** Componentes de interfaz y foco: 3:1 (AA no textual). */
const NO_TEXTO: [string, string][] = [
  ["fog", "canvas"], ["fog", "paper"],            // borde de los campos de fecha
  ["ink", "canvas"],                               // borde del campo del chat y del login
  ["blue", "canvas"], ["blue", "paper"], ["blue", "muted-card"], // anillo de foco
  ...["dot-nuevo", "dot-decision", "dot-listo", "dot-enviado", "dot-bloqueado"].flatMap((d) => ["canvas", "paper"].map((f) => [d, f] as [string, string])),
]

for (const [tema, paleta] of [["claro", claro], ["oscuro", oscuro]] as const) {
  describe(`contraste AA, tema ${tema}`, () => {
    test("se leyeron los tokens del CSS", () => {
      for (const k of ["canvas", "paper", "muted-card", "ash", "smoke", "ink", "charcoal", "steel", "fog", "blue", "primary-bg", "dot-nuevo", "txt-listo", "sel-bg"]) expect(paleta[k], `falta --${k}`).toBeDefined()
    })
    test("texto: al menos 4.5:1 en cada par usado", () => {
      const mal = TEXTO.map(([f, b]) => ({ par: `${f} sobre ${b}`, r: ratio(paleta[f] as string, paleta[b] as string) })).filter((x) => x.r < 4.5)
      expect(mal.map((x) => `${x.par}: ${x.r.toFixed(2)}`)).toEqual([])
    })
    test("campos, foco y puntos de estado: al menos 3:1", () => {
      const mal = NO_TEXTO.map(([f, b]) => ({ par: `${f} sobre ${b}`, r: ratio(paleta[f] as string, paleta[b] as string) })).filter((x) => x.r < 3)
      expect(mal.map((x) => `${x.par}: ${x.r.toFixed(2)}`)).toEqual([])
    })
  })
}

describe("tokens del diseño (una sola fuente de verdad)", () => {
  test("los valores del tema claro son los del diseño", () => {
    expect(claro).toMatchObject({
      canvas: "#ffffff", paper: "#f5f5f5", "muted-card": "#fafafa", ash: "#e5e5e5", smoke: "#d4d4d4",
      ink: "#0a0a0a", charcoal: "#171717", steel: "#525252", fog: "#737373", blue: "#2563eb",
      "primary-bg": "#0a0a0a", hover: "#ececec", "sel-bg": "#dbeafe", "sel-ink": "#1e40af",
      "dot-nuevo": "#737373", "dot-decision": "#ea580c", "dot-listo": "#16a34a", "dot-enviado": "#2563eb", "dot-bloqueado": "#dc2626",
    })
  })
  test("el tema oscuro deriva canvas #0a0a0a, paper #171717, bordes #262626, texto #ededed y el mismo azul", () => {
    expect(oscuro).toMatchObject({ canvas: "#0a0a0a", paper: "#171717", ash: "#262626", ink: "#ededed", blue: "#2563eb" })
  })
  test("los colores de los puntos son los del diseño en ambos temas; solo el texto se oscurece o aclara para pasar AA", () => {
    for (const p of [claro, oscuro]) expect(p).toMatchObject({ "dot-decision": "#ea580c", "dot-listo": "#16a34a", "dot-bloqueado": "#dc2626", "dot-enviado": "#2563eb", "dot-nuevo": "#737373" })
    expect(ratio(claro["dot-decision"] as string, claro.canvas as string)).toBeLessThan(4.5) // el tono del diseño NO pasa como texto…
    expect(ratio(claro["txt-decision"] as string, claro.canvas as string)).toBeGreaterThanOrEqual(4.5) // …por eso el texto usa uno más oscuro
  })
  test("ningún texto es #000 ni #fff puro (salvo el texto del botón primario sobre negro)", () => {
    for (const k of ["ink", "charcoal", "steel", "fog-text", "txt-nuevo", "txt-decision", "txt-listo", "txt-enviado", "txt-bloqueado"]) expect(claro[k]).not.toBe("#000000")
    expect(claro["primary-ink"]).toBe("#ffffff")
  })
})

describe("reglas del sistema visual en el CSS", () => {
  test("no hay colores sueltos fuera de los tokens (ningún #hex, rgb(), rgba() ni hsl())", () => {
    const sueltos = resto.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []
    expect(sueltos).toEqual([])
  })
  test("los radios usan solo el vocabulario: 6 (inputs), 8 (botones), 12 (tarjetas) y 16 (drawers y login); los puntos son círculos", () => {
    for (const [r, v] of Object.entries({ "r-input": "6px", "r-btn": "8px", "r-card": "12px", "r-panel": "16px" })) expect(bloqueClaro).toContain(`--${r}: ${v};`)
    const valores = [...resto.matchAll(/border-radius:\s*([^;}]+)[;}]/g)].flatMap((m) => (m[1] as string).trim().split(/\s+/))
    expect(valores.length).toBeGreaterThan(10)
    const malos = valores.filter((v) => !/^(var\(--r-(input|btn|card|panel)\)|50%|0)$/.test(v))
    expect(malos).toEqual([])
    expect(resto).not.toMatch(/9999px|999px/)
  })
  test("profundidad: borde de 1px de baja opacidad + sombra en capas muy suave (claro); en oscuro, solo bordes", () => {
    expect(bloqueClaro).toContain("--hairline: rgba(0, 0, 0, 0.08);")
    expect(bloqueClaro).toContain("--shadow-card: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.04);")
    expect(bloqueClaro).toContain("--shadow-float: 0 1px 2px rgba(0, 0, 0, 0.05), 0 8px 24px rgba(0, 0, 0, 0.08);")
    expect(bloqueOscuro).toContain("--shadow-card: none;")
    expect(bloqueOscuro).toContain("--shadow-float: none;")
    expect(bloqueOscuro).toMatch(/--hairline: rgba\(255, 255, 255, 0\.1\);/)
    expect(resto).toMatch(/\.tarjeta \{[^}]*border: 1px solid var\(--hairline\)[^}]*box-shadow: var\(--shadow-card\)/)
  })
  test("las únicas sombras son: botón primario, anillo de drawers, tarjetas y composer (todas desde tokens)", () => {
    const usos = [...resto.matchAll(/box-shadow:\s*([^;}]+)[;}]/g)].map((m) => (m[1] as string).trim())
    expect(usos.length).toBeGreaterThan(4)
    expect(usos.filter((u) => !["var(--btn-shadow)", "var(--ring)", "var(--shadow-card)", "var(--shadow-float)", "none"].includes(u))).toEqual([])
    expect(bloqueClaro).toContain("--btn-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);")
    expect(bloqueClaro).toContain("--ring: 0 0 0 4px rgba(0, 0, 0, 0.08);")
    expect(resto.match(/box-shadow:\s*var\(--btn-shadow\)/g)?.length).toBe(1)
  })
  test("encabezado: sticky, translúcido, con blur de 8px y borde sutil", () => {
    expect(resto).toMatch(/\.encabezado \{[^}]*position: sticky; top: 0;/)
    expect(resto).toMatch(/\.encabezado \{[^}]*background: color-mix\(in srgb, var\(--canvas\) 82%, transparent\)/)
    expect(resto).toMatch(/\.encabezado \{[^}]*backdrop-filter: blur\(8px\)/)
    expect(resto).toMatch(/\.encabezado \{[^}]*border-bottom: 1px solid var\(--hairline\)/)
    expect(resto).toMatch(/\.encabezado \{[^}]*min-height: 56px/)
  })
  test("bandeja: ítems sin caja; el seleccionado lleva fondo neutro y barra de acento de 2px (no el azul lleno)", () => {
    expect(resto).toMatch(/\.caso-fila\[aria-current="true"\], \.hist-item\[aria-current="true"\] \{ background: var\(--hover\);/)
    expect(resto).toMatch(/\[aria-current="true"\]::before \{[^}]*width: 2px; background: var\(--blue\)/)
    expect(resto).not.toMatch(/aria-current[^{]*\{[^}]*var\(--sel-bg\)/)
  })
  test("composer flotante: radio de tarjeta, sombra suave y botón de ícono dentro del campo", () => {
    expect(resto).toMatch(/\.form-chat \{[^}]*border-radius: var\(--r-card\); box-shadow: var\(--shadow-float\)/)
    expect(resto).toMatch(/\.form-chat \{[^}]*max-width: 720px/)
    expect(resto).toContain(".btn.icono { width: 36px; padding: 0; }")
  })
  test("microinteracciones: hover sube 1px, pulsación escala 0.98, y sin movimiento con «reducir movimiento»", () => {
    expect(resto).toMatch(/\.btn:hover:not\(:disabled\) \{[^}]*transform: translateY\(-1px\)/)
    expect(resto).toMatch(/\.btn:active:not\(:disabled\) \{ transform: scale\(0\.98\); \}/)
    expect(resto).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.btn:hover:not\(:disabled\), \.btn:active:not\(:disabled\) \{ transform: none; \}/)
  })
  test("esqueletos de carga y estado vacío con ícono grande y suave (sin caja punteada)", () => {
    expect(resto).toMatch(/\.sk \{[^}]*animation: pulso 1\.2s ease-in-out infinite/)
    expect(resto).toMatch(/\.vacio-amable svg\.lucide \{ width: 32px; height: 32px;/)
    expect(resto).not.toMatch(/\.vacio-amable \{[^}]*dashed/)
  })
  test("la regla de la tarjeta de decisión se pliega animando la altura (filas de grid de 0fr a 1fr)", () => {
    expect(resto).toMatch(/\.regla-cuerpo \{ display: grid; grid-template-rows: 0fr; transition: grid-template-rows var\(--t\) ease-out; \}/)
    expect(resto).toMatch(/\.regla-cuerpo\.abierto \{ grid-template-rows: 1fr; \}/)
    expect(resto).toMatch(/\.valor-grande \{[^}]*font-family: var\(--mono\); font-size: 20px/)
  })
  test("un solo degradado en toda la interfaz: el radial tenue del ingreso, hecho con los neutros existentes", () => {
    expect(resto).not.toMatch(/linear-gradient|conic-gradient/)
    expect(resto.match(/-gradient\(/g)?.length).toBe(1)
    expect(resto).toContain("background-image: radial-gradient(ellipse 80% 60% at 50% 30%, var(--canvas), var(--paper))")
    expect(css).not.toContain("--dots")
  })
  test("tipografía: Inter 400, 500 y 600 y JetBrains Mono autoalojadas, con fallback de sistema", () => {
    for (const w of [400, 500, 600]) expect(css).toContain(`font-family: "Inter"; font-style: normal; font-weight: ${w}`)
    expect(css).toContain('font-family: "JetBrains Mono"')
    expect(css).not.toMatch(/url\("https?:/) // ninguna fuente externa
    expect(bloqueClaro).toMatch(/--font: "Inter", system-ui/)
  })
  test("escala tipográfica: solo 11, 12, 13, 14, 15, 16 y 20 px, y pesos 400, 500 y 600", () => {
    const tamanos = new Set([...resto.matchAll(/font-size:\s*(\d+)px/g)].map((m) => m[1]))
    for (const t of tamanos) expect(["11", "12", "13", "14", "15", "16", "20"], `tamaño ${t}px fuera de la escala`).toContain(t as string)
    const pesos = new Set([...resto.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]))
    for (const p of pesos) expect(["400", "500", "600"]).toContain(p as string)
    expect(resto).toMatch(/h1 \{[^}]*font-size: 20px; font-weight: 600; letter-spacing: -0\.01em/)
  })
  test("los íconos de Lucide van con trazo de 1.75 y 16 px", () => {
    expect(resto).toMatch(/svg\.lucide \{ width: 16px; height: 16px; stroke-width: 1\.75; \}/)
  })
  test("el atributo hidden siempre oculta (si no, las trazabilidades salen abiertas)", () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/)
  })
  test("el CSS respeta la reducción de movimiento y define el foco visible de 2px en azul", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/)
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--blue\)/)
  })
  test("animaciones de 150 a 200 ms", () => {
    const ms = [...resto.matchAll(/\b(\d+)ms\b/g)].map((m) => Number(m[1]))
    expect(ms.length).toBeGreaterThan(5)
    expect(ms.filter((n) => n < 150 || n > 200)).toEqual([])
    expect(bloqueClaro).toContain("--t: 160ms;")
  })
  test("los estados se muestran con un punto de 8px y texto, nunca como pastilla", () => {
    expect(resto).toMatch(/\.estado::before \{ content: ""; width: 8px; height: 8px; border-radius: 50%/)
    expect(resto).toMatch(/\.punto \{ width: 8px; height: 8px; border-radius: 50%/)
  })
})
