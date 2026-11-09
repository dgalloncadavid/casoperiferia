import { config } from "../config"
import { CASO_RE, listarCasos } from "../core/fixtures"
import { mapearCaso } from "../core/formulario"
import type { EstadoCaso } from "../core/paquete"
import { normalizar, resolverFecha } from "../core/util"
import { ErrorLLM, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "../llm/adapter"
import { CadenaAgotada } from "../llm/cadena"
import { costoUsd } from "../llm/precios"
import { processCaso } from "../process"
import type { Storage } from "../storage"
import { definicionesParaModelo, ejecutarHerramienta, esHerramienta, resumirResultado } from "./herramientas"
import { cargarSystemPrompt } from "./prompt"
import { textoConfirmacion, textoResumen, textoTopeIteraciones } from "./textos"
import type { EntradaChat, Pendiente, RespuestaChat, Sesion, VistaLlamada } from "./tipos"

export interface Dependencias {
  directory: string
  storage: Storage
  /** null = sin proveedores configurados (modo sin modelo). */
  llm: ProveedorLLM | null
}

export interface PeticionChat {
  sessionId: string
  message: string
  /** Botón estructurado de la UI. */
  confirm?: boolean
}

const MAX_RESULTADO_PARA_MODELO = 8000
const hoyUtc = () => new Date().toISOString().slice(0, 10)

export const esEnvia = (texto: string): boolean => normalizar(texto).replace(/[^a-z ]/g, "").trim() === "envia"

async function cargarSesion(storage: Storage, id: string): Promise<Sesion> {
  const guardada = (await storage.loadSession(id).catch(() => null)) as Sesion | null
  return guardada ?? { id, creada: new Date().toISOString(), mensajes: [], historial: [], tokens: 0 }
}

async function registrar(deps: Dependencias, sessionId: string, herramienta: string, ok: boolean, resumen: string): Promise<void> {
  await deps.storage
    .appendLog({ ts: new Date().toISOString(), herramienta, ok, resumen: resumen.slice(0, 300), caso: null, sessionId })
    .catch(() => undefined)
}

// ---------- confirmación (la controla el servidor) ----------

async function proponerEnvio(deps: Dependencias, caso: string, ctx: ReturnType<typeof contexto>): Promise<string> {
  const bytes = await deps.storage.readFile(`${caso}/estado.json`)
  const estado = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as EstadoCaso) : null
  const m = await mapearCaso(caso, ctx)
  const faltantes = m.ok ? m.data.campos.filter((c) => c.estado === "faltante").map((c) => c.etiqueta) : []
  return textoConfirmacion(caso, estado ? !estado.listo_para_firma : true, estado?.bloqueadores ?? [], faltantes)
}

async function paqueteArmado(deps: Dependencias, caso: string): Promise<EstadoCaso | null> {
  if (!CASO_RE.test(caso)) return null
  const bytes = await deps.storage.readFile(`${caso}/estado.json`)
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as EstadoCaso) : null
}

function contexto(deps: Dependencias, sessionId: string) {
  return { directory: deps.directory, sessionId }
}

async function ejecutarEnvio(deps: Dependencias, sesion: Sesion, caso: string): Promise<{ texto: string; llamada: VistaLlamada }> {
  // El `confirmado` lo pone el servidor, solo tras el botón o «envía».
  const args = { caso, confirmado: true }
  const json = await ejecutarHerramienta("proveedor_simular_envio", args, contexto(deps, sesion.id))
  const { ok, resumen } = resumirResultado("proveedor_simular_envio", json)
  const r = JSON.parse(json) as { data?: { incompleto?: boolean; existente?: boolean; ruta?: string }; error?: string }
  const texto = !ok
    ? `No pude registrar el envío simulado: ${r.error ?? "error desconocido"}.`
    : [
        r.data?.existente ? `Este envío ya estaba registrado; no se duplicó (${r.data.ruta}).` : `Listo: dejé el envío simulado en ${r.data?.ruta}.`,
        r.data?.incompleto ? "Quedó marcado como INCOMPLETO por lo pendiente que te indiqué." : "El paquete estaba completo.",
        "No se envió nada real: queda en manos de una persona.",
      ].join("\n")
  return { texto, llamada: { nombre: "proveedor_simular_envio", args: { caso }, ok, resumen } }
}

// ---------- modo sin modelo ----------

async function responderSinModelo(deps: Dependencias, sesion: Sesion, mensaje: string, fecha: string): Promise<{ texto: string; llamadas: VistaLlamada[]; propuesta?: string; caso?: string }> {
  const ctx = { ...contexto(deps, sesion.id), fechaReferencia: fecha }
  const casos = await listarCasos(ctx)
  const norm = normalizar(mensaje)
  const caso = casos.find((c) => norm.includes(c))
  if (!caso) {
    return { texto: `Estoy en modo sin modelo: puedo procesar un caso si me das su nombre exacto. Casos disponibles: ${casos.join(", ")}.`, llamadas: [] }
  }
  const resumen = await processCaso(caso, ctx)
  const llamadas: VistaLlamada[] = [
    { nombre: "processCaso", args: { caso }, ok: resumen.ok, resumen: `${resumen.total_campos ?? 0} campos, firma: ${resumen.estado_firma ?? "n/d"}` },
  ]
  const propone = resumen.ok && resumen.estado_firma !== "no_aplica" && resumen.estado_firma !== undefined
  return { texto: textoResumen(resumen, fecha), llamadas, ...(propone ? { caso } : {}) }
}

// ---------- ciclo con modelo ----------

type MotivoSinModelo = "sin_proveedores" | "tope_global" | "tope_sesion" | "proveedores_agotados"
const AVISOS: Record<MotivoSinModelo, string> = {
  sin_proveedores: "No hay ningún modelo configurado: trabajo en modo sin modelo.",
  tope_global: "Se alcanzó el tope de gasto diario del servicio: trabajo en modo sin modelo hasta mañana.",
  tope_sesion: "Esta sesión alcanzó su tope de tokens: sigo en modo sin modelo. Abre una sesión nueva para volver a conversar con el modelo.",
  proveedores_agotados: "Los modelos no están disponibles en este momento (créditos, límite o tiempo): trabajo en modo sin modelo.",
}

interface ResultadoCiclo {
  texto: string
  llamadas: VistaLlamada[]
  pendiente?: Pendiente
  proveedor?: string
  modelo?: string
  sinModelo?: MotivoSinModelo
}

async function cicloConModelo(deps: Dependencias, sesion: Sesion, mensaje: string, fecha: string, llm: ProveedorLLM): Promise<ResultadoCiclo> {
  const maxIter = config.maxIterations()
  const defs = definicionesParaModelo()
  const sistema = `${await cargarSystemPrompt(deps.directory)}\n\nFecha de referencia para evaluar la vigencia de los soportes: ${fecha}.`
  const msgs: Mensaje[] = [{ role: "system", content: sistema }, ...sesion.mensajes, { role: "user", content: mensaje }]
  const ctx = { ...contexto(deps, sesion.id), fechaReferencia: fecha }
  const llamadas: VistaLlamada[] = []
  let ultima: RespuestaLLM | null = null
  let candidatoEnvio: string | null = null

  for (let i = 0; i < maxIter; i++) {
    if (sesion.tokens >= config.sessionTokenCap()) return { texto: "", llamadas, sinModelo: "tope_sesion" }
    const gasto = await deps.storage.getUsage(hoyUtc()).catch(() => null)
    if (gasto && gasto.costoUsd >= config.globalDailyUsdCap()) return { texto: "", llamadas, sinModelo: "tope_global" }

    let resp: RespuestaLLM
    try {
      resp = await llm.enviar(msgs, defs)
    } catch (e) {
      if (e instanceof CadenaAgotada) return { texto: "", llamadas, sinModelo: "proveedores_agotados" }
      if (e instanceof ErrorLLM) {
        // Se conservan las llamadas ya hechas en este turno para que sigan visibles.
        await registrar(deps, sesion.id, "llm_error", false, `${e.proveedor}: ${e.message}`)
        return { texto: `No pude consultar el modelo (${e.message}). La sesión sigue activa: puedes intentarlo de nuevo.`, llamadas }
      }
      throw e
    }
    ultima = resp
    sesion.tokens += resp.uso.entrada + resp.uso.salida
    await deps.storage
      .addUsage(hoyUtc(), { tokensEntrada: resp.uso.entrada, tokensSalida: resp.uso.salida, costoUsd: costoUsd(resp.modelo, resp.uso), peticiones: 1 })
      .catch(() => undefined)

    if (resp.llamadas.length === 0) {
      return finalizar(deps, resp.texto ?? "", llamadas, candidatoEnvio, ctx, resp)
    }

    msgs.push({ role: "assistant", content: resp.texto, llamadas: resp.llamadas })
    for (const l of resp.llamadas) {
      const { contenido, vista, envioPropuesto } = await atenderLlamada(deps, l.nombre, l.argumentos, ctx)
      llamadas.push(vista)
      msgs.push({ role: "tool", llamadaId: l.id, nombre: l.nombre, content: contenido.slice(0, MAX_RESULTADO_PARA_MODELO) })
      if (envioPropuesto) {
        // El modelo pidió enviar: el turno termina con la pregunta del servidor.
        return finalizar(deps, resp.texto ?? "", llamadas, envioPropuesto, ctx, resp)
      }
      if (vista.nombre === "proveedor_armar_paquete" && vista.ok && typeof vista.args.caso === "string") candidatoEnvio = vista.args.caso
    }
  }
  return { texto: textoTopeIteraciones(maxIter, llamadas), llamadas, proveedor: ultima?.proveedor, modelo: ultima?.modelo }
}

async function finalizar(
  deps: Dependencias,
  textoModelo: string,
  llamadas: VistaLlamada[],
  casoParaEnvio: string | null,
  ctx: ReturnType<typeof contexto>,
  resp: RespuestaLLM,
): Promise<ResultadoCiclo> {
  let texto = textoModelo.trim()
  let pendiente: Pendiente | undefined
  if (casoParaEnvio) {
    const estado = await paqueteArmado(deps, casoParaEnvio)
    if (estado && estado.estado_firma !== "no_aplica") {
      pendiente = { caso: casoParaEnvio, accion: "simular_envio" }
      texto = `${texto}${texto ? "\n\n" : ""}${await proponerEnvio(deps, casoParaEnvio, ctx)}`
    }
  }
  return { texto: texto || "No tengo nada más que informar.", llamadas, pendiente, proveedor: resp.proveedor, modelo: resp.modelo }
}

async function atenderLlamada(
  deps: Dependencias,
  nombre: string,
  argumentos: string,
  ctx: ReturnType<typeof contexto> & { fechaReferencia: string },
): Promise<{ contenido: string; vista: VistaLlamada; envioPropuesto?: string }> {
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(argumentos || "{}")
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch {
    const contenido = JSON.stringify({ ok: false, error: "argumentos no son JSON válido" })
    return { contenido, vista: { nombre, args: {}, ok: false, resumen: "argumentos no son JSON válido" } }
  }
  if (!esHerramienta(nombre)) {
    const contenido = JSON.stringify({ ok: false, error: `herramienta desconocida: ${nombre}` })
    return { contenido, vista: { nombre, args: {}, ok: false, resumen: "herramienta desconocida" } }
  }
  const vistaArgs = { ...(typeof args.caso === "string" ? { caso: args.caso } : {}) }

  if (nombre === "proveedor_simular_envio") {
    // Se ignora `confirmado` del modelo: el servidor pide la confirmación al usuario.
    const caso = typeof args.caso === "string" ? args.caso : ""
    if (!(await paqueteArmado(deps, caso))) {
      const contenido = JSON.stringify({ ok: false, error: "arma primero el paquete con proveedor_armar_paquete" })
      return { contenido, vista: { nombre, args: vistaArgs, ok: false, resumen: "falta armar el paquete" } }
    }
    const contenido = JSON.stringify({ ok: false, error: "requiere confirmación explícita: el servidor se la pedirá al usuario" })
    return { contenido, vista: { nombre, args: vistaArgs, ok: false, resumen: "requiere confirmación del usuario" }, envioPropuesto: caso }
  }

  const contenido = await ejecutarHerramienta(nombre, args, ctx)
  const { ok, resumen } = resumirResultado(nombre, contenido)
  return { contenido, vista: { nombre, args: vistaArgs, ok, resumen } }
}

// ---------- punto de entrada ----------

export async function manejarChat(deps: Dependencias, p: PeticionChat): Promise<RespuestaChat> {
  const sesion = await cargarSesion(deps.storage, p.sessionId)
  const fecha = resolverFecha({ directory: deps.directory, sessionId: p.sessionId }) ?? "2026-09-03"
  const ahora = () => new Date().toISOString()
  const mensaje = p.message.trim()
  const pendiente = sesion.pendiente
  sesion.pendiente = undefined // vale solo para el mensaje inmediatamente siguiente

  let aviso: string | undefined
  let reply = ""
  let toolCalls: VistaLlamada[] = []
  let nuevoPendiente: Pendiente | undefined
  let modo: "modelo" | "sin_modelo" = deps.llm ? "modelo" : "sin_modelo"
  let proveedor: string | undefined
  let modelo: string | undefined

  sesion.historial.push({ rol: "user", texto: p.confirm ? "[Botón] Confirmar envío" : mensaje, ts: ahora() })

  if (pendiente && (p.confirm === true || esEnvia(mensaje))) {
    const envio = await ejecutarEnvio(deps, sesion, pendiente.caso)
    reply = envio.texto
    toolCalls = [envio.llamada]
    sesion.mensajes.push({ role: "user", content: mensaje || "envía" }, { role: "assistant", content: reply })
  } else {
    if (pendiente) aviso = "La confirmación de envío pendiente se canceló porque tu mensaje no fue «envía» ni el botón."
    const motivoPrevio: MotivoSinModelo | null = !deps.llm ? "sin_proveedores" : sesion.tokens >= config.sessionTokenCap() ? "tope_sesion" : null
    let resultado: ResultadoCiclo | null = null
    if (!motivoPrevio && deps.llm) {
      try {
        resultado = await cicloConModelo(deps, sesion, mensaje, fecha, deps.llm)
      } catch (e) {
        const detalle = e instanceof ErrorLLM ? e.message : "error inesperado"
        await registrar(deps, sesion.id, "llm_error", false, `${e instanceof ErrorLLM ? e.proveedor : "?"}: ${detalle}`)
        resultado = { texto: `No pude consultar el modelo (${detalle}). La sesión sigue activa: puedes intentarlo de nuevo.`, llamadas: [] }
      }
    }
    const motivo = motivoPrevio ?? resultado?.sinModelo
    if (motivo) {
      modo = "sin_modelo"
      if (motivo === "tope_sesion") sesion.sinModelo = true
      aviso = [aviso, AVISOS[motivo]].filter(Boolean).join(" ")
      await registrar(deps, sesion.id, "modo_sin_modelo", true, motivo)
      const sm = await responderSinModelo(deps, sesion, mensaje, fecha)
      reply = sm.texto
      toolCalls = [...(resultado?.llamadas ?? []), ...sm.llamadas]
      if (sm.caso) {
        nuevoPendiente = { caso: sm.caso, accion: "simular_envio" }
        reply += `\n\n${await proponerEnvio(deps, sm.caso, contexto(deps, sesion.id))}`
      }
    } else if (resultado) {
      reply = resultado.texto
      toolCalls = resultado.llamadas
      nuevoPendiente = resultado.pendiente
      proveedor = resultado.proveedor
      modelo = resultado.modelo
    }
    sesion.mensajes.push({ role: "user", content: mensaje }, { role: "assistant", content: reply })
  }

  sesion.pendiente = nuevoPendiente
  const entrada: EntradaChat = { rol: "assistant", texto: reply, ts: ahora(), toolCalls, needsConfirmation: Boolean(nuevoPendiente), ...(aviso ? { aviso } : {}) }
  sesion.historial.push(entrada)
  sesion.mensajes = sesion.mensajes.slice(-20)
  await deps.storage.saveSession(sesion.id, sesion)

  return {
    sessionId: sesion.id,
    reply,
    toolCalls,
    needsConfirmation: Boolean(nuevoPendiente),
    ...(nuevoPendiente ? { pendiente: nuevoPendiente } : {}),
    modo,
    ...(aviso ? { aviso } : {}),
    ...(proveedor ? { proveedor, modelo } : {}),
    fechaReferencia: fecha,
  }
}

export { cargarSesion }
