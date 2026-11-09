import { agrupar, normalizar } from "./util"
import type { CampoMapeado, CampoPlantilla } from "./types"

export const IDENTIFICADOR_POR_PAIS: Record<string, string> = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" }

const PAISES: Record<string, string> = {
  CO: "Colombia",
  EC: "Ecuador",
  PE: "Perú",
  PA: "Panamá",
  HN: "Honduras",
}

const CONF_EXACTA = 1.0
const CONF_NORMALIZADA = 0.9
const CONF_REGLA = 0.7
export const UMBRAL_CONFIANZA = 0.8

function obtener(maestro: Record<string, unknown>, ruta: string): unknown {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

function formatear(clave: string, valor: unknown, maestro: Record<string, unknown>): string | null {
  if (clave === "pais" && typeof valor === "string") return PAISES[valor] ?? null
  if (clave === "ingresos_ultimo_ano.valor" && typeof valor === "number") {
    const moneda = obtener(maestro, "ingresos_ultimo_ano.moneda")
    const ano = obtener(maestro, "ingresos_ultimo_ano.ano")
    return `${agrupar(valor)} ${String(moneda)} (${String(ano)})`
  }
  if (typeof valor === "string" && valor.trim() !== "") return valor
  if (typeof valor === "number") return String(valor)
  return null
}

function buscarClave(
  etiqueta: string,
  glosario: Record<string, string>,
): { clave: string; confianza: number } | null {
  const exacta = glosario[etiqueta]
  if (exacta) return { clave: exacta, confianza: CONF_EXACTA }
  const objetivo = normalizar(etiqueta)
  for (const [k, v] of Object.entries(glosario)) {
    if (normalizar(k) === objetivo) return { clave: v, confianza: CONF_NORMALIZADA }
  }
  return null
}

function mapearCampo(
  campo: CampoPlantilla,
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
  pais: string,
): CampoMapeado {
  const base = { etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, hoja: campo.hoja, celda_etiqueta: campo.celda_etiqueta, celda_valor: campo.celda_valor }
  const hallado = buscarClave(campo.etiqueta, glosario)
  if (!hallado) {
    return { ...base, estado: "faltante", confianza: 0, nota: "no existe en el glosario ni en el maestro" }
  }
  const { clave } = hallado
  let { confianza } = hallado
  const notas: string[] = []

  if (clave === "digito_verificacion" && pais !== "CO") {
    return { ...base, estado: "faltante", confianza: 0, clave, nota: "el dígito de verificación solo aplica a Colombia" }
  }

  const valor = formatear(clave, obtener(maestro, clave), maestro)
  if (valor === null) {
    return { ...base, estado: "faltante", confianza: 0, clave, nota: "el maestro no tiene este dato" }
  }

  if (clave === "nit") {
    const local = IDENTIFICADOR_POR_PAIS[pais] ?? "identificador tributario"
    if (pais !== "CO") {
      confianza = Math.min(confianza, CONF_REGLA)
      notas.push(`identificador extranjero: se usa el NIT colombiano como ${local}`)
    } else if (normalizar(campo.etiqueta) !== "nit") {
      confianza = Math.min(confianza, CONF_REGLA)
      notas.push("etiqueta de identificador ambigua: se propone el NIT")
    }
  }
  if (clave === "ingresos_ultimo_ano.valor") {
    confianza = Math.min(confianza, CONF_REGLA)
    notas.push("la cifra está en COP del maestro; confirmar moneda con el cliente")
  }

  const estado = confianza < UMBRAL_CONFIANZA ? "requiere_confirmacion" : "lleno"
  return {
    ...base,
    estado,
    confianza,
    clave,
    ruta_maestro: clave,
    valor,
    ...(notas.length ? { nota: notas.join("; ") } : {}),
  }
}

export function mapear(
  campos: CampoPlantilla[],
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
  pais: string,
): CampoMapeado[] {
  return campos.map((c) => mapearCampo(c, glosario, maestro, pais))
}
