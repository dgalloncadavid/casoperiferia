import { z } from "zod"
import { herramientas } from "../tools/proveedor"
import type { DefHerramienta } from "../llm/adapter"
import type { VistaLlamada } from "./tipos"

export type NombreHerramienta = `proveedor_${keyof typeof herramientas}`

const porNombre = new Map(
  Object.entries(herramientas).map(([clave, h]) => [`proveedor_${clave}`, h] as const),
)

export function esHerramienta(nombre: string): nombre is NombreHerramienta {
  return (porNombre as Map<string, unknown>).has(nombre)
}

export function ejecutarHerramienta(nombre: NombreHerramienta, args: unknown, ctx: Parameters<(typeof herramientas)["leer_solicitud"]["execute"]>[1]): Promise<string> {
  const h = (porNombre as Map<string, (typeof herramientas)[keyof typeof herramientas]>).get(nombre)
  if (!h) return Promise.resolve(JSON.stringify({ ok: false, error: "herramienta desconocida" }))
  return (h.execute as (a: unknown, c: typeof ctx) => Promise<string>)(args, ctx)
}

/** Definiciones que ve el modelo: sin los argumentos que se ignoran o controla el servidor. */
export function definicionesParaModelo(): DefHerramienta[] {
  return [...porNombre.entries()].map(([name, h]) => {
    const ocultos = new Set<string>(h.ocultarAlModelo)
    const visibles = Object.fromEntries(Object.entries(h.args).filter(([k]) => !ocultos.has(k)))
    return { name, description: h.description, parameters: z.toJSONSchema(z.object(visibles), { io: "input" }) as Record<string, unknown> }
  })
}

interface Resultado {
  ok?: boolean
  error?: string
  data?: Record<string, unknown>
}

const largo = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

/** Resumen corto para el chat. Nunca incluye valores del formulario. */
export function resumirResultado(nombre: string, json: string): { ok: boolean; resumen: string } {
  let r: Resultado
  try {
    r = JSON.parse(json) as Resultado
  } catch {
    return { ok: false, resumen: "respuesta ilegible" }
  }
  if (!r.ok) return { ok: false, resumen: r.error ?? "error" }
  const d = r.data ?? {}
  switch (nombre) {
    case "proveedor_leer_solicitud":
      return { ok: true, resumen: `formato ${String(d.formato)}, ${largo(d.campos)} campos, ${largo(d.soportes)} soportes exigidos` }
    case "proveedor_mapear_campos":
      return { ok: true, resumen: `${largo(d.llenos)} llenos, ${largo(d.requiere_confirmacion)} por confirmar, ${largo(d.faltantes)} faltantes` }
    case "proveedor_generar_formulario":
      return { ok: true, resumen: `${String(d.formato)} → ${String(d.ruta)}` }
    case "proveedor_armar_paquete":
      return { ok: true, resumen: `paquete ${String(d.estado_firma)} → ${String(d.ruta)}` }
    case "proveedor_simular_envio":
      return { ok: true, resumen: `${d.incompleto ? "INCOMPLETO" : "completo"} → ${String(d.ruta)}` }
    default:
      return { ok: true, resumen: "ok" }
  }
}

export type { VistaLlamada }
