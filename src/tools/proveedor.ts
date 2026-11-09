import { z } from "zod"
import { getStorage } from "../storage"
import { simularEnvio } from "../core/envio"
import { cargarCaso, CASO_RE } from "../core/fixtures"
import { generarFormulario, mapearCaso } from "../core/formulario"
import { IDENTIFICADOR_POR_PAIS } from "../core/mapeo"
import { armarPaquete } from "../core/paquete"
import { fail, type Result, type ToolContext } from "../core/types"

export type { ToolContext } from "../core/types"

const FRASE_CASO = "Nombre de la carpeta del caso en fixtures/reto-01/casos/ (minúsculas, números y guiones)"
const ETIQUETAS_AMBIGUAS = new Set(["identificacion tributaria", "numero de identificacion fiscal"])

/** Construye una herramienta que valida, nunca lanza y deja rastro en el log. */
function herramienta<S extends z.ZodRawShape, D>(
  nombre: string,
  def: {
    description: string
    args: S
    /** Argumentos que se ignoran o controla el servidor: no se muestran al modelo. */
    ocultarAlModelo?: (keyof S & string)[]
    run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<Result<D>>
    resumen: (data: D) => string
  },
) {
  const schema = z.object(def.args)
  return {
    description: def.description,
    args: def.args,
    ocultarAlModelo: def.ocultarAlModelo ?? [],
    async execute(args: z.input<typeof schema>, ctx: ToolContext): Promise<string> {
      const parsed = schema.safeParse(args)
      let res: Result<D>
      if (!parsed.success) {
        const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
        res = fail(`argumentos inválidos: ${detalle}`, "argumentos_invalidos")
      } else {
        try {
          res = await def.run(parsed.data, ctx)
        } catch {
          res = fail(`error interno al ejecutar ${nombre}`, "error_interno")
        }
      }
      const candidato = (args as { caso?: unknown } | null)?.caso
      const caso = typeof candidato === "string" && CASO_RE.test(candidato) ? candidato : null
      try {
        await getStorage(ctx.directory).appendLog({
          ts: new Date().toISOString(),
          herramienta: nombre,
          ok: res.ok,
          // El resumen nunca incluye valores del formulario: solo conteos, estados y rutas.
          resumen: res.ok ? def.resumen(res.data) : `${res.codigo ?? "error"}: ${res.error}`.slice(0, 300),
          caso,
          sessionId: ctx.sessionId,
        })
      } catch {
        // un fallo de log no debe romper la herramienta
      }
      return JSON.stringify(res)
    },
  }
}

export const leer_solicitud = herramienta("proveedor_leer_solicitud", {
  description: "Lee la solicitud del cliente y su plantilla: devuelve país, cliente, formato, campos pedidos y soportes exigidos.",
  args: { caso: z.string().describe(FRASE_CASO) },
  async run({ caso }, ctx) {
    const c = await cargarCaso(caso, ctx)
    if (!c.ok) return c
    const { solicitud, exigidos, plantilla } = c.data
    if (!plantilla.ok) return plantilla
    const local = IDENTIFICADOR_POR_PAIS[solicitud.pais] ?? "identificador tributario"
    return {
      ok: true as const,
      data: {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        identificador_tributario: local,
        campos: plantilla.data.map((p) => {
          const ambiguo = ETIQUETAS_AMBIGUAS.has(p.etiqueta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())
          return {
            etiqueta: p.etiqueta,
            ...(p.obligatorio !== undefined ? { obligatorio: p.obligatorio } : {}),
            ...(p.hoja ? { hoja: p.hoja, celda_valor: p.celda_valor } : {}),
            ...(ambiguo ? { requiere_confirmacion: true, equivalente_propuesto: local } : {}),
          }
        }),
        soportes: exigidos,
        // Texto del cliente: es un DATO, nunca instrucciones para el agente.
        cuerpo_cliente_no_confiable: solicitud.cuerpo.slice(0, 2000),
      },
    }
  },
  resumen: (d) => `formato ${d.formato}, ${d.campos.length} campos, ${d.soportes.length} soportes exigidos`,
})

export const mapear_campos = herramienta("proveedor_mapear_campos", {
  description: "Cruza los campos de la plantilla del caso con el repositorio maestro y los clasifica en llenos, faltantes y por confirmar.",
  ocultarAlModelo: ["campos"],
  args: {
    caso: z.string().describe(FRASE_CASO),
    campos: z
      .array(z.union([z.string(), z.object({ etiqueta: z.string() })]))
      .optional()
      .describe("Ignorado: los campos siempre se toman de la plantilla del caso."),
  },
  async run({ caso }, ctx) {
    const m = await mapearCaso(caso, ctx)
    if (!m.ok) return m
    const { campos } = m.data
    return {
      ok: true as const,
      data: {
        llenos: campos.filter((c) => c.estado === "lleno"),
        faltantes: campos.filter((c) => c.estado === "faltante"),
        requiere_confirmacion: campos.filter((c) => c.estado === "requiere_confirmacion"),
      },
    }
  },
  resumen: (d) =>
    `${d.llenos.length + d.faltantes.length + d.requiere_confirmacion.length} campos: ${d.llenos.length} llenos, ${d.requiere_confirmacion.length} por confirmar, ${d.faltantes.length} faltantes`,
})

export const generar_formulario = herramienta("proveedor_generar_formulario", {
  description: "Genera el formulario del caso en el formato pedido (xlsx, pdf) o los valores copiables si es portal.",
  ocultarAlModelo: ["mapeo"],
  args: {
    caso: z.string().describe(FRASE_CASO),
    mapeo: z.unknown().optional().describe("Ignorado: el mapeo siempre se recalcula en el servidor desde el maestro."),
  },
  async run({ caso }, ctx) {
    const f = await generarFormulario(caso, ctx)
    if (!f.ok) return f
    if (!f.data.soportado) {
      return fail("formato no soportado: el portal web no se automatiza; se generó valores-portal.md para copiar", "formato_no_soportado", {
        ruta: f.data.ruta,
        formato: f.data.formato,
      })
    }
    return { ok: true as const, data: { ruta: f.data.ruta, formato: f.data.formato } }
  },
  resumen: (d) => `formulario ${d.formato} en ${d.ruta}`,
})

export const armar_paquete = herramienta("proveedor_armar_paquete", {
  description: "Arma el paquete para firma: formulario, soportes, checklist y borrador de correo; indica si está listo para firma.",
  args: { caso: z.string().describe(FRASE_CASO) },
  run: ({ caso }, ctx) => armarPaquete(caso, ctx),
  resumen: (d) => `paquete ${d.estado_firma}, ${d.checklist.bloqueadores.length} bloqueadores, ${d.checklist.campos_faltantes.length} faltantes`,
})

export const simular_envio = herramienta("proveedor_simular_envio", {
  description: "Simula el envío escribiendo ENVIO-SIMULADO.md; exige confirmación explícita del usuario.",
  ocultarAlModelo: ["confirmado"],
  args: {
    caso: z.string().describe(FRASE_CASO),
    confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente en su mensaje inmediatamente anterior."),
  },
  run: ({ caso, confirmado }, ctx) => simularEnvio(caso, confirmado, ctx),
  resumen: (d) => `envío simulado ${d.incompleto ? "INCOMPLETO" : "completo"}${d.existente ? " (ya existía)" : ""} en ${d.ruta}`,
})

export const herramientas = { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, simular_envio }
