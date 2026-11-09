// Vistas para el panel de la analista: bandeja, caso con trazabilidad y reporte entre casos.
// Todo se calcula en vivo (mapeo y soportes son deterministas) con la fecha de referencia elegida.
import { getStorage } from "../storage"
import { enmascararCuenta, esSensible } from "./enmascarar"
import { listarCasos } from "./fixtures"
import { mapearCaso } from "./formulario"
import type { EstadoCaso } from "./paquete"
import { describirSoporte, evaluarSoportes, nombreSoporte } from "./soportes"
import { fail, ok, type Alerta, type CampoMapeado, type EstadoSoporte, type Result, type ToolContext } from "./types"
import { fechaColombia, normalizar } from "./util"

export type EstadoBandeja = "nuevo" | "decision" | "listo" | "enviado"
export type Decision = "confirmado" | "revisar"
export type Decisiones = Record<string, { decision: Decision; ts: string }>

export interface ConsumoCaso {
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
  turnos: number
}

const TEXTO_ESTADO: Record<EstadoBandeja, string> = {
  nuevo: "Nuevo",
  decision: "Necesita tu decisión",
  listo: "Listo para firma",
  enviado: "Enviado",
}

const GRUPOS: Record<string, string> = {
  banco: "Datos bancarios",
  representante_legal: "Representante legal",
  contacto_comercial: "Contacto comercial",
  contacto_financiero: "Contacto financiero",
  ingresos_ultimo_ano: "Ingresos",
}

const HERRAMIENTAS: Record<string, string> = {
  proveedor_mapear_campos: "Mapeo de campos",
  proveedor_generar_formulario: "Generación del formulario",
}

const leerJson = async <T>(rel: string, ctx: ToolContext): Promise<T | null> => {
  const bytes = await getStorage(ctx.directory, ctx.userId).readFile(rel)
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null
}

export const leerDecisiones = async (caso: string, ctx: ToolContext): Promise<Decisiones> =>
  (await leerJson<Decisiones>(`${caso}/decisiones.json`, ctx)) ?? {}

export const leerConsumo = (caso: string, ctx: ToolContext): Promise<ConsumoCaso | null> => leerJson<ConsumoCaso>(`${caso}/costo.json`, ctx)

export async function guardarDecision(caso: string, etiqueta: string, decision: Decision, ctx: ToolContext): Promise<Result<Decisiones>> {
  const m = await mapearCaso(caso, ctx)
  if (!m.ok) return m
  const campo = m.data.campos.find((c) => c.etiqueta === etiqueta)
  if (!campo || campo.estado !== "requiere_confirmacion") return fail("ese campo no está pendiente de confirmación", "campo_invalido")
  const decisiones = await leerDecisiones(caso, ctx)
  decisiones[etiqueta] = { decision, ts: new Date().toISOString() }
  await getStorage(ctx.directory, ctx.userId).writeFile(`${caso}/decisiones.json`, JSON.stringify(decisiones, null, 2))
  return ok(decisiones)
}

export async function sumarConsumo(caso: string, extra: { entrada: number; salida: number; costoUsd: number }, ctx: ToolContext): Promise<void> {
  const a = (await leerConsumo(caso, ctx)) ?? { tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, turnos: 0 }
  const total: ConsumoCaso = {
    tokensEntrada: a.tokensEntrada + extra.entrada,
    tokensSalida: a.tokensSalida + extra.salida,
    costoUsd: a.costoUsd + extra.costoUsd,
    turnos: a.turnos + 1,
  }
  await getStorage(ctx.directory, ctx.userId).writeFile(`${caso}/costo.json`, JSON.stringify(total))
}

function origenLegible(campo: CampoMapeado, glosario: Record<string, string>): string {
  if (!campo.clave) return "No existe en el maestro"
  const grupo = GRUPOS[campo.clave.split(".")[0] as string]
  const etiqueta = Object.entries(glosario).find(([, v]) => v === campo.clave)?.[0] ?? campo.clave.replace(/[._]/g, " ")
  return ["Maestro de Periferia", grupo, etiqueta].filter(Boolean).join(" › ")
}

function destinoLegible(campo: CampoMapeado, posicion: number, formato: string): string {
  if (formato === "xlsx" && campo.hoja && campo.celda_valor) return `Hoja «${campo.hoja}», celda ${campo.celda_valor}`
  return formato === "portal" ? `Campo ${posicion} de la lista para el portal` : `Campo ${posicion} del formulario`
}

function textoSoporte(estado: EstadoSoporte, alerta: Alerta): string {
  if (estado === "ausente") return "No está en el repositorio"
  if (estado === "vencido") return "Vencido"
  return alerta === "verde" ? "Vigente" : alerta === "amarilla" ? "Vigente, por vencer pronto" : "Vigente, vence en muy pocos días"
}

export interface VistaCaso {
  caso: string
  cliente: string
  pais: string
  formato: string
  asunto: string
  de: string
  fechaSolicitud: string
  fechaReferencia: string
  estado: EstadoBandeja
  estadoTexto: string
  motivos: string[]
  procesado: boolean
  enviado: boolean
  enviadoIncompleto: boolean
  paqueteConOtraFecha: string | null
  totalCampos: number
  soportes: {
    tipo: string
    nombre: string
    estado: EstadoSoporte
    estadoTexto: string
    alerta: Alerta
    vigenciaHasta: string | null
    diasRestantes: number | null
    detalle: string
    advertencia: string | null
  }[]
  campos: {
    etiqueta: string
    estado: string
    valor: string | null
    enmascarado: boolean
    obligatorio: boolean
    confianza: number
    origen: string
    herramienta: { nombre: string; tecnico: string; cuando: string | null }
    destino: string
    nota: string | null
    razon: string | null
    regla: string | null
    decision: Decision | null
  }[]
  pendientes: string[]
  /** Lo que la analista confirmó o mandó a revisar, con fecha (más reciente primero). */
  decisiones: { etiqueta: string; valor: string | null; decision: Decision; ts: string; fechaColombia: string }[]
  /** Última vez que algo se hizo en este caso (herramientas o decisiones), ISO; null si nunca. */
  ultimaActividad: string | null
  faltantes: string[]
  archivos: string[]
  consumo: ConsumoCaso | null
  puedeProponerEnvio: boolean
}

export async function vistaCaso(caso: string, ctx: ToolContext, fecha: string): Promise<Result<VistaCaso>> {
  const m = await mapearCaso(caso, { ...ctx, fechaReferencia: fecha })
  if (!m.ok) {
    // Plantilla corrupta u otro error: no hay vista, el chat ya lo explica en lenguaje claro.
    return m
  }
  const storage = getStorage(ctx.directory, ctx.userId)
  const { solicitud, exigidos, campos, repo } = m.data
  const estadoCaso = await leerJson<EstadoCaso>(`${caso}/estado.json`, ctx)
  const procesado = estadoCaso !== null
  const enviado = await storage.exists(`${caso}/ENVIO-SIMULADO.md`)
  const decisiones = await leerDecisiones(caso, ctx)
  const soportes = await evaluarSoportes(exigidos, repo.soportes, repo.dirSoportes, solicitud.pais, fecha)
  const logs = await storage.readLogs(caso).catch(() => [])
  const cuando = (herr: string) => logs.filter((l) => l.herramienta === herr && l.ok).at(-1)?.ts ?? null

  const vistaCampos = campos.map((c, i) => {
    const sensible = esSensible(c.clave)
    const dec = decisiones[c.etiqueta]?.decision ?? null
    const herr = "proveedor_mapear_campos"
    return {
      etiqueta: c.etiqueta,
      estado: c.estado,
      valor: c.valor === undefined ? null : sensible ? enmascararCuenta(c.valor) : c.valor,
      enmascarado: sensible && c.valor !== undefined,
      obligatorio: c.obligatorio ?? false,
      confianza: c.confianza,
      origen: origenLegible(c, repo.glosario),
      herramienta: { nombre: HERRAMIENTAS[herr] as string, tecnico: herr, cuando: cuando(herr) },
      destino: destinoLegible(c, i + 1, solicitud.formato),
      nota: c.nota ?? null,
      razon: c.razon ?? null,
      regla: c.regla ?? null,
      decision: dec,
    }
  })

  const pendientes = vistaCampos.filter((c) => c.estado === "requiere_confirmacion" && c.decision !== "confirmado").map((c) => c.etiqueta)
  const bloqueadores = soportes.filter((s) => s.estado !== "vigente").map((s) => describirSoporte(s))
  const motivos: string[] = []
  if (pendientes.length) motivos.push(pendientes.length === 1 ? "1 valor por confirmar" : `${pendientes.length} valores por confirmar`)
  motivos.push(...bloqueadores)

  let estado: EstadoBandeja
  if (enviado) estado = "enviado"
  else if (!procesado) estado = "nuevo"
  else if (motivos.length > 0) estado = "decision"
  else estado = "listo"

  const textoEstado = estado === "listo" && solicitud.formato === "portal" ? "Listo para copiar al portal" : TEXTO_ESTADO[estado]
  const envioMd = enviado ? new TextDecoder().decode((await storage.readFile(`${caso}/ENVIO-SIMULADO.md`)) ?? new Uint8Array()) : ""
  const archivos = (await storage.list(caso)).map((a) => a.slice(caso.length + 1)).filter((a) => !["log.jsonl", "estado.json", "decisiones.json", "costo.json"].includes(a))

  return ok({
    caso,
    cliente: solicitud.cliente,
    pais: solicitud.pais,
    formato: solicitud.formato,
    asunto: solicitud.asunto,
    de: solicitud.de,
    fechaSolicitud: solicitud.fecha,
    fechaReferencia: fecha,
    estado,
    estadoTexto: textoEstado,
    motivos,
    procesado,
    enviado,
    enviadoIncompleto: /INCOMPLETO/.test(envioMd),
    paqueteConOtraFecha: estadoCaso && estadoCaso.fecha_referencia !== fecha ? estadoCaso.fecha_referencia : null,
    totalCampos: campos.length,
    soportes: soportes.map((s) => ({
      tipo: s.tipo,
      nombre: nombreSoporte(s.tipo),
      estado: s.estado,
      estadoTexto: textoSoporte(s.estado, s.alerta),
      alerta: s.alerta,
      vigenciaHasta: s.vigencia_hasta,
      diasRestantes: s.dias_restantes,
      detalle: describirSoporte(s).split(": ").slice(1).join(": "),
      advertencia: s.advertencia ?? null,
    })),
    campos: procesado ? vistaCampos : [],
    pendientes: procesado ? pendientes : [],
    decisiones: Object.entries(decisiones)
      .map(([etiqueta, d]) => {
        const campo = campos.find((c) => c.etiqueta === etiqueta)
        const valor = campo?.valor === undefined ? null : esSensible(campo.clave) ? enmascararCuenta(campo.valor) : campo.valor
        return { etiqueta, valor, decision: d.decision, ts: d.ts, fechaColombia: fechaColombia(d.ts) }
      })
      .sort((a, b) => b.ts.localeCompare(a.ts)),
    ultimaActividad: [logs.at(-1)?.ts, ...Object.values(decisiones).map((d) => d.ts)].filter((t): t is string => typeof t === "string").sort().at(-1) ?? null,
    faltantes: campos.filter((c) => c.estado === "faltante").map((c) => c.etiqueta),
    archivos,
    consumo: await leerConsumo(caso, ctx),
    puedeProponerEnvio: procesado && !enviado && solicitud.formato !== "portal",
  })
}

export interface FilaResumen {
  caso: string
  cliente: string
  pais: string
  formato: string
  estado: EstadoBandeja
  estadoTexto: string
  procesado: boolean
  /** Campos con dato seguro (lleno) y total pedido; null si el caso aún no se procesó. */
  camposLlenos: number | null
  camposTotal: number
  /** Valores por confirmar que siguen sin confirmar; null si no se procesó. */
  porConfirmar: number | null
  soportesProblema: { total: number; nombres: string[]; vencidos: number; faltantes: number }
  ultimaActividad: string | null
  fechaColombia: string | null
}

/** Una fila por caso para la vista en tabla, calculada con la fecha elegida y solo con los datos del usuario. */
export async function resumenCasos(ctx: ToolContext, fecha: string): Promise<FilaResumen[]> {
  const filas: FilaResumen[] = []
  for (const caso of await listarCasos(ctx)) {
    const v = await vistaCaso(caso, ctx, fecha)
    if (!v.ok) {
      filas.push({ caso, cliente: caso, pais: "", formato: "", estado: "decision", estadoTexto: "Necesita tu decisión", procesado: false, camposLlenos: null, camposTotal: 0, porConfirmar: null, soportesProblema: { total: 0, nombres: [], vencidos: 0, faltantes: 0 }, ultimaActividad: null, fechaColombia: null })
      continue
    }
    const d = v.data
    const problemas = d.soportes.filter((s) => s.estado !== "vigente")
    filas.push({
      caso,
      cliente: d.cliente,
      pais: d.pais,
      formato: d.formato,
      estado: d.estado,
      estadoTexto: d.estadoTexto,
      procesado: d.procesado,
      camposLlenos: d.procesado ? d.campos.filter((c) => c.estado === "lleno").length : null,
      camposTotal: d.totalCampos,
      porConfirmar: d.procesado ? d.pendientes.length : null,
      soportesProblema: { total: problemas.length, nombres: problemas.map((s) => s.nombre), vencidos: problemas.filter((s) => s.estado !== "ausente").length, faltantes: problemas.filter((s) => s.estado === "ausente").length },
      ultimaActividad: d.ultimaActividad,
      fechaColombia: d.ultimaActividad ? fechaColombia(d.ultimaActividad) : null,
    })
  }
  return filas
}

export interface FilaBandeja {
  caso: string
  cliente: string
  pais: string
  formato: string
  estado: EstadoBandeja
  estadoTexto: string
  motivos: string[]
  faltantes: number
}

export async function bandeja(ctx: ToolContext, fecha: string): Promise<FilaBandeja[]> {
  const filas: FilaBandeja[] = []
  for (const caso of await listarCasos(ctx)) {
    const v = await vistaCaso(caso, ctx, fecha)
    if (!v.ok) {
      filas.push({ caso, cliente: caso, pais: "", formato: "", estado: "decision", estadoTexto: "Necesita tu decisión", motivos: ["No se pudo leer la solicitud"], faltantes: 0 })
      continue
    }
    const d = v.data
    filas.push({ caso, cliente: d.cliente, pais: d.pais, formato: d.formato, estado: d.estado, estadoTexto: d.estadoTexto, motivos: d.motivos, faltantes: d.faltantes.length })
  }
  return filas
}

export interface Reporte {
  fechaReferencia: string
  casos: {
    caso: string
    cliente: string
    pais: string
    estado: EstadoBandeja
    estadoTexto: string
    faltantes: string[]
    porConfirmar: string[]
    soportesAActualizar: string[]
    consumo: ConsumoCaso | null
  }[]
  faltantesPorCampo: { campo: string; casos: { caso: string; cliente: string }[] }[]
  totalCostoUsd: number
  totalTokens: number
}

export async function reporte(ctx: ToolContext, fecha: string): Promise<Reporte> {
  const casos: Reporte["casos"] = []
  for (const caso of await listarCasos(ctx)) {
    const v = await vistaCaso(caso, ctx, fecha)
    if (!v.ok) continue
    const d = v.data
    const mapeo = await mapearCaso(caso, { ...ctx, fechaReferencia: fecha })
    const decisiones = await leerDecisiones(caso, ctx)
    casos.push({
      caso,
      cliente: d.cliente,
      pais: d.pais,
      estado: d.estado,
      estadoTexto: d.estadoTexto,
      faltantes: d.faltantes,
      porConfirmar: mapeo.ok ? mapeo.data.campos.filter((c) => c.estado === "requiere_confirmacion" && decisiones[c.etiqueta]?.decision !== "confirmado").map((c) => c.etiqueta) : [],
      soportesAActualizar: d.soportes.filter((s) => s.estado !== "vigente").map((s) => `${s.nombre} (${s.estado === "ausente" ? "falta" : "vencido"})`),
      consumo: d.consumo,
    })
  }
  const porCampo = new Map<string, { caso: string; cliente: string }[]>()
  for (const c of casos) for (const f of c.faltantes) porCampo.set(f, [...(porCampo.get(f) ?? []), { caso: c.caso, cliente: c.cliente }])
  return {
    fechaReferencia: fecha,
    casos,
    faltantesPorCampo: [...porCampo].sort((a, b) => normalizar(a[0]).localeCompare(normalizar(b[0]))).map(([campo, cs]) => ({ campo, casos: cs })),
    totalCostoUsd: casos.reduce((s, c) => s + (c.consumo?.costoUsd ?? 0), 0),
    totalTokens: casos.reduce((s, c) => s + (c.consumo ? c.consumo.tokensEntrada + c.consumo.tokensSalida : 0), 0),
  }
}

