import { describe, expect, test } from "bun:test"
import { mapear } from "../src/core/mapeo"
import { evaluarSoportes } from "../src/core/soportes"
import type { IndiceSoportes } from "../src/core/fixtures"
import path from "node:path"

const glosario: Record<string, string> = {
  "Razón social": "razon_social",
  Teléfono: "telefono",
  NIT: "nit",
  RUC: "nit",
  "Identificación tributaria": "nit",
  "Dígito de verificación": "digito_verificacion",
  País: "pais",
  "Ingresos anuales": "ingresos_ultimo_ano.valor",
}
const maestro = {
  razon_social: "Periferia IT Group S.A.S.",
  telefono: "+57 604 555 0100",
  nit: "900123456",
  digito_verificacion: "7",
  pais: "CO",
  ingresos_ultimo_ano: { valor: 98000000000, moneda: "COP", ano: 2025 },
}
const campo = (etiqueta: string, pais = "CO") => mapear([{ etiqueta }], glosario, maestro, pais)[0]!

describe("mapeo: confianza y estados (HU-2, RN1, supuestos 4, 6, 14, 15)", () => {
  test("etiqueta exacta → 1.0 y lleno, con la ruta del maestro", () => {
    expect(campo("Razón social")).toMatchObject({ estado: "lleno", confianza: 1.0, ruta_maestro: "razon_social", valor: "Periferia IT Group S.A.S." })
  })
  test("sin tildes ni mayúsculas → 0.9 y lleno", () => {
    expect(campo("telefono")).toMatchObject({ estado: "lleno", confianza: 0.9 })
    expect(campo("RAZON SOCIAL")).toMatchObject({ estado: "lleno", confianza: 0.9 })
  })
  test("sin parecido, aunque se asemeje, → faltante (nunca por aproximación)", () => {
    expect(campo("Razon social del proveedor")).toMatchObject({ estado: "faltante", confianza: 0 })
    expect(campo("Teléfonos")).toMatchObject({ estado: "faltante" })
    expect(campo("Sitio favorito del gerente").valor).toBeUndefined()
  })
  test("identificador extranjero → 0.7 por confirmar con la nota; en Colombia con «NIT» queda lleno", () => {
    expect(campo("RUC", "EC")).toMatchObject({ estado: "requiere_confirmacion", confianza: 0.7, valor: "900123456" })
    expect(campo("RUC", "EC").nota).toContain("identificador extranjero")
    expect(campo("NIT", "CO")).toMatchObject({ estado: "lleno", confianza: 1.0 })
  })
  test("etiqueta ambigua o de otro país, incluso en Colombia → por confirmar", () => {
    expect(campo("Identificación tributaria", "CO")).toMatchObject({ estado: "requiere_confirmacion", confianza: 0.7 })
    expect(campo("RUC", "CO")).toMatchObject({ estado: "requiere_confirmacion" })
  })
  test("el dígito de verificación solo aplica a Colombia", () => {
    expect(campo("Dígito de verificación", "CO")).toMatchObject({ estado: "lleno", valor: "7" })
    expect(campo("Dígito de verificación", "EC")).toMatchObject({ estado: "faltante" })
  })
  test("ingresos con moneda y año, por confirmar, sin convertir", () => {
    expect(campo("Ingresos anuales")).toMatchObject({ estado: "requiere_confirmacion", valor: "98.000.000.000 COP (2025)" })
  })
  test("el país se normaliza con diccionario y cuenta como lleno con confianza 1.0", () => {
    expect(campo("País")).toMatchObject({ estado: "lleno", valor: "Colombia", confianza: 1.0 })
  })
  test("un dato ausente en el maestro → faltante, nunca inventado", () => {
    const sin = mapear([{ etiqueta: "Razón social" }], glosario, {}, "CO")[0]!
    expect(sin).toMatchObject({ estado: "faltante" })
    expect(sin.valor).toBeUndefined()
  })
})

describe("soportes: vigencia y alertas (HU-4, RN3, supuestos 2, 3, 9)", () => {
  const dir = path.resolve(import.meta.dirname, "../fixtures/reto-01/repositorio/soportes")
  const indice = (vigencia: string | null, pais = "CO"): IndiceSoportes => [
    { tipo: "rut", archivo: "rut-2026.txt", vigencia_hasta: vigencia, pais_emisor: pais },
  ]
  const evaluar = async (vigencia: string | null, fecha = "2026-09-03", pais = "CO") => (await evaluarSoportes(["rut"], indice(vigencia, pais), dir, "CO", fecha))[0]!
  const hasta = (dias: number) => new Date(Date.UTC(2026, 8, 3 + dias)).toISOString().slice(0, 10)

  test("umbrales: 30 días o más verde; 29 amarilla; 15 amarilla; 14 roja", async () => {
    expect((await evaluar(hasta(30))).alerta).toBe("verde")
    expect((await evaluar(hasta(29))).alerta).toBe("amarilla")
    expect((await evaluar(hasta(15))).alerta).toBe("amarilla")
    expect((await evaluar(hasta(14))).alerta).toBe("roja")
  })
  test("vence hoy sigue vigente (roja); un día antes es vencido", async () => {
    expect(await evaluar(hasta(0))).toMatchObject({ estado: "vigente", alerta: "roja", dias_restantes: 0 })
    expect(await evaluar(hasta(-1))).toMatchObject({ estado: "vencido", alerta: "roja", dias_restantes: -1 })
  })
  test("sin vigencia (null) es vigente y verde", async () => {
    expect(await evaluar(null)).toMatchObject({ estado: "vigente", alerta: "verde", dias_restantes: null })
  })
  test("tipo exigido que no existe en el repositorio → ausente", async () => {
    const r = (await evaluarSoportes(["no_existe"], indice(null), dir, "CO", "2026-09-03"))[0]!
    expect(r).toMatchObject({ estado: "ausente", alerta: "roja" })
  })
  test("archivo del índice que no existe en disco o con ruta sospechosa → ausente", async () => {
    const malo: IndiceSoportes = [{ tipo: "rut", archivo: "../maestro.json", vigencia_hasta: null, pais_emisor: "CO" }]
    expect((await evaluarSoportes(["rut"], malo, dir, "CO", "2026-09-03"))[0]!.estado).toBe("ausente")
  })
  test("soporte de otro país: advertencia, no bloqueo", async () => {
    const r = await evaluar(hasta(200), "2026-09-03", "EC")
    expect(r.estado).toBe("vigente")
    expect(r.advertencia).toContain("emitido en EC")
  })
  test("fecha de referencia distinta cambia el resultado (supuesto 2)", async () => {
    expect((await evaluar("2026-09-30", "2026-09-03")).alerta).toBe("amarilla")
    expect((await evaluar("2026-09-30", "2026-11-09")).estado).toBe("vencido")
  })
})
