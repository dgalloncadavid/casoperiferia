/** Claves de JSON Schema que algunos proveedores (p. ej. Gemini) rechazan en `parameters`. */
const CLAVES_NO_SOPORTADAS = new Set(["$schema", "additionalProperties", "propertyNames", "$id", "examples", "default"])

/** Limpia el esquema generado por zod sin tocar las herramientas. */
export function limpiarEsquema(valor: unknown): Record<string, unknown> {
  const limpio = limpiar(valor)
  return typeof limpio === "object" && limpio !== null && !Array.isArray(limpio) ? (limpio as Record<string, unknown>) : { type: "object", properties: {} }
}

function limpiar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limpiar)
  if (typeof valor !== "object" || valor === null) return valor
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor)) {
    if (CLAVES_NO_SOPORTADAS.has(k)) continue
    salida[k] = limpiar(v)
  }
  return salida
}
