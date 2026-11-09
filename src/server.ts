import { createHash, timingSafeEqual } from "node:crypto"
import { Hono, type Context } from "hono"
import { authActiva, authConfigurada, configPublica, verificarToken, type Usuario } from "./auth"
import { manejarChat, cargarSesion, esDeUsuario, proponerEnvioDesdePanel, type Dependencias } from "./agent/ciclo"
import type { EstadoSesion, ResumenSesion } from "./agent/tipos"
import { config } from "./config"
import { CASO_RE, listarCasos } from "./core/fixtures"
import { fechaValida, resolverFecha } from "./core/util"
import { processCaso } from "./process"
import { bandeja, guardarDecision, reporte, vistaCaso } from "./core/vista"
import { crearCadena, proveedoresConfigurados } from "./llm/cadena"
import { ambitoDeUsuario, getStorage } from "./storage"

const SESION_RE = /^[A-Za-z0-9_-]{8,64}$/
const SEGMENTO_RE = /^[A-Za-z0-9._-]+$/
const TIPOS: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
/** Archivos internos que no se ofrecen en la descarga. */
const INTERNOS = new Set(["log.jsonl", "estado.json", "decisiones.json", "costo.json"])

const directorio = () => process.env.APP_DIR ?? process.cwd()

let deps: Dependencias | null = null
function dependencias(): Dependencias {
  if (deps) return deps
  const directory = directorio()
  const storage = getStorage(directory)
  const cadena = crearCadena((desde, causa) => {
    // Cada cambio de proveedor queda en el log.
    void storage
      .appendLog({ ts: new Date().toISOString(), herramienta: "llm_failover", ok: false, resumen: `${desde} no disponible (${causa.tipo}); se prueba el siguiente`, caso: null })
      .catch(() => undefined)
  })
  deps = { directory, storage, llm: cadena.vacia ? null : cadena }
  return deps
}

/** Solo para pruebas: sustituye las dependencias. */
export function _setDependencias(d: Dependencias | null): void {
  deps = d
}

function ipDe(c: Context): string {
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  return xff || c.req.header("x-real-ip") || "local"
}
const huella = (valor: string): string => createHash("sha256").update(valor).digest("hex").slice(0, 16)

function mismaClave(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

export const app = new Hono<{ Variables: { usuario: Usuario | null } }>()

/** Rutas públicas aun con login: el front necesita saber si hay login y cómo conectarse antes de iniciar sesión. */
const RUTAS_PUBLICAS = new Set(["/api/health", "/api/config"])

// Con AUTH=on, todo /api/* exige un Bearer válido de Supabase Auth (salvo health y config).
app.use("/api/*", async (c, next) => {
  c.set("usuario", null)
  if (!authActiva() || RUTAS_PUBLICAS.has(new URL(c.req.url).pathname)) return next()
  if (!authConfigurada()) return c.json({ error: "El inicio de sesión no está configurado en el servidor." }, 503)
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")
  const usuario = bearer ? await verificarToken(bearer[1] as string) : null
  if (!usuario) return c.json({ error: "Inicia sesión para continuar." }, 401)
  c.set("usuario", usuario)
  return next()
})

app.get("/api/config", (c) => c.json(configPublica()))

app.get("/api/health", (c) => {
  const d = dependencias()
  const proveedores = proveedoresConfigurados()
  const activo = proveedores[0]
  return c.json({
    ok: true,
    provider: activo?.nombre ?? "ninguno",
    model: activo?.modelo ?? "ninguno",
    cadena: proveedores.map((p) => `${p.nombre}:${p.modelo}`),
    modo: d.llm ? "modelo" : "sin_modelo",
    fechaReferencia: resolverFecha({ directory: d.directory, sessionId: "health" }),
    storage: d.storage.kind,
    auth: authActiva() ? "on" : "off",
  })
})

/** Límite de peticiones por IP (compartido por el chat y las acciones del panel). */
async function limitar(c: Context): Promise<Response | null> {
  const golpes = await dependencias().storage.rateHit(`ip:${huella(ipDe(c))}`, 60).catch(() => 0)
  if (golpes <= config.rateLimitPerMin()) return null
  c.header("Retry-After", "60")
  return c.json({ error: `Demasiados mensajes: el límite es ${config.rateLimitPerMin()} por minuto. Espera un momento.` }, 429)
}

/** Fecha de referencia pedida (consulta o cuerpo) o la predeterminada; null si no es válida. */
function fechaPedida(pedida: string | undefined | null): string | null {
  if (pedida) return fechaValida(pedida) ? pedida : null
  return resolverFecha({ directory: directorio(), sessionId: "panel" })
}
const usuarioDe = (c: Context): string | null => (c.get("usuario") as Usuario | null)?.id ?? null
const ctxPanel = (c: Context) => ({ directory: directorio(), sessionId: "panel", userId: usuarioDe(c) })
const FECHA_INVALIDA = { error: "La fecha de referencia no es válida (usa AAAA-MM-DD)." }

app.post("/api/chat", async (c) => {
  const d = dependencias()
  let cuerpo: { sessionId?: unknown; message?: unknown; confirm?: unknown; fecha?: unknown }
  try {
    cuerpo = (await c.req.json()) as typeof cuerpo
  } catch {
    return c.json({ error: "El cuerpo debe ser JSON: { sessionId, message }." }, 400)
  }
  const sessionId = typeof cuerpo.sessionId === "string" && cuerpo.sessionId ? cuerpo.sessionId : crypto.randomUUID()
  if (!SESION_RE.test(sessionId)) return c.json({ error: "sessionId inválido (8 a 64 caracteres: letras, números, _ y -)." }, 400)
  const message = typeof cuerpo.message === "string" ? cuerpo.message : ""
  const confirm = cuerpo.confirm === true
  if (!confirm && message.trim() === "") return c.json({ error: "Escribe un mensaje." }, 400)
  if (message.length > config.maxMessageChars()) {
    return c.json({ error: `El mensaje es demasiado largo (máximo ${config.maxMessageChars()} caracteres).` }, 413)
  }

  const fecha = typeof cuerpo.fecha === "string" && cuerpo.fecha !== "" ? cuerpo.fecha : undefined
  if (fecha && !fechaValida(fecha)) return c.json({ error: "La fecha de referencia no es válida (usa AAAA-MM-DD)." }, 400)
  const limite = await limitar(c)
  if (limite) return limite

  const usuarioId = usuarioDe(c)
  const existente = (await d.storage.loadSession(sessionId).catch(() => null)) as { usuarioId?: string | null } | null
  if (existente && (existente.usuarioId ?? null) !== usuarioId) return c.json({ error: "No encontré esa conversación." }, 404)

  try {
    return c.json(await manejarChat(d, { sessionId, message, confirm, fecha, usuarioId }))
  } catch {
    return c.json({ error: "Ocurrió un error inesperado procesando el mensaje. La sesión sigue activa; intenta de nuevo." }, 500)
  }
})

const TEXTO_ESTADO_SESION: Record<EstadoSesion, string> = { en_curso: "En curso", listo: "Listo", bloqueado: "Bloqueado", incompleto: "Incompleto" }
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
/** «9 nov 2026, 3:42 p. m.» en hora de Colombia. Colombia es UTC-5 todo el año (sin horario de verano), así que no depende de la ICU del entorno. */
export const fechaColombia = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000)
  const h = d.getUTCHours()
  const hora12 = h % 12 === 0 ? 12 : h % 12
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hora12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`
}

// Historial: SOLO las conversaciones del usuario autenticado, las más recientes primero.
app.get("/api/sessions", async (c) => {
  const filas = await dependencias().storage.listSessions(usuarioDe(c))
  return c.json({
    sesiones: filas.map((f) => {
      const r = (f.resumen ?? { caso: null, estado: "en_curso" }) as ResumenSesion
      return { id: f.id, actualizada: f.updatedAt, fechaColombia: fechaColombia(f.updatedAt), caso: r.caso, estado: r.estado, estadoTexto: TEXTO_ESTADO_SESION[r.estado] ?? "En curso" }
    }),
  })
})

app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id")
  if (!SESION_RE.test(id)) return c.json({ error: "sessionId inválido" }, 400)
  const d = dependencias()
  const s = await cargarSesion(d.storage, id, usuarioDe(c))
  // Una conversación de otro usuario se ve igual que una inexistente: no se revela que existe.
  if (s.historial.length === 0 || !esDeUsuario(s, usuarioDe(c))) return c.json({ error: "sesión no encontrada" }, 404)
  return c.json({ id: s.id, creada: s.creada, actualizada: s.actualizada, fechaColombia: fechaColombia(s.actualizada), resumen: s.resumen, historial: s.historial, pendiente: s.pendiente ?? null, tokens: s.tokens, sinModelo: s.sinModelo ?? false })
})

async function casoValido(caso: string): Promise<boolean> {
  if (!CASO_RE.test(caso)) return false
  const casos = await listarCasos({ directory: directorio(), sessionId: "descarga" })
  return casos.includes(caso)
}

app.get("/api/paquetes/:caso", async (c) => {
  const caso = c.req.param("caso")
  if (!(await casoValido(caso))) return c.json({ error: "caso no encontrado" }, 404)
  const archivos = (await ambitoDeUsuario(dependencias().storage, usuarioDe(c)).list(caso)).map((a) => a.slice(caso.length + 1)).filter((a) => !INTERNOS.has(a.split("/").pop() ?? ""))
  return c.json({ caso, archivos })
})

app.get("/api/paquetes/:caso/*", async (c) => {
  const caso = c.req.param("caso")
  if (!(await casoValido(caso))) return c.json({ error: "caso no encontrado" }, 404)
  const marca = `/api/paquetes/${caso}/`
  const resto = decodeURIComponent(new URL(c.req.url).pathname.slice(new URL(c.req.url).pathname.indexOf(marca) + marca.length))
  const segmentos = resto.split("/")
  if (segmentos.length === 0 || !segmentos.every((s) => SEGMENTO_RE.test(s) && s !== "." && s !== "..")) {
    return c.json({ error: "ruta inválida" }, 400)
  }
  const nombre = segmentos[segmentos.length - 1] as string
  const storage = ambitoDeUsuario(dependencias().storage, usuarioDe(c)) // solo los archivos de ESTE usuario
  const permitidos = await storage.list(caso)
  if (INTERNOS.has(nombre) || !permitidos.includes(`${caso}/${resto}`)) return c.json({ error: "archivo no encontrado" }, 404)
  const bytes = await storage.readFile(`${caso}/${resto}`)
  if (!bytes) return c.json({ error: "archivo no encontrado" }, 404)
  const ext = nombre.split(".").pop() ?? ""
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": TIPOS[ext] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${nombre}"`,
      "x-content-type-options": "nosniff",
    },
  })
})

app.get("/api/casos", async (c) => {
  const fecha = fechaPedida(c.req.query("fecha"))
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  return c.json({ fechaReferencia: fecha, casos: await bandeja(ctxPanel(c), fecha) })
})

app.get("/api/casos/:caso", async (c) => {
  const caso = c.req.param("caso")
  const fecha = fechaPedida(c.req.query("fecha"))
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  if (!(await casoValido(caso))) return c.json({ error: "No encontré ese caso." }, 404)
  const v = await vistaCaso(caso, ctxPanel(c), fecha)
  return v.ok ? c.json(v.data) : c.json({ error: v.error }, 422)
})

app.post("/api/casos/:caso/procesar", async (c) => {
  const caso = c.req.param("caso")
  const cuerpo = (await c.req.json().catch(() => ({}))) as { fecha?: unknown }
  const fecha = fechaPedida(typeof cuerpo.fecha === "string" ? cuerpo.fecha : undefined)
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  if (!(await casoValido(caso))) return c.json({ error: "No encontré ese caso." }, 404)
  const limite = await limitar(c)
  if (limite) return limite
  // Sin modelo: las mismas herramientas, en orden. No gasta tokens.
  const resumen = await processCaso(caso, { ...ctxPanel(c), fechaReferencia: fecha })
  const v = await vistaCaso(caso, ctxPanel(c), fecha)
  return c.json({ resumen: { ok: resumen.ok, avisos: resumen.avisos }, caso: v.ok ? v.data : null })
})

app.post("/api/casos/:caso/decisiones", async (c) => {
  const caso = c.req.param("caso")
  const cuerpo = (await c.req.json().catch(() => ({}))) as { campo?: unknown; decision?: unknown; fecha?: unknown }
  const fecha = fechaPedida(typeof cuerpo.fecha === "string" ? cuerpo.fecha : undefined)
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  if (!(await casoValido(caso))) return c.json({ error: "No encontré ese caso." }, 404)
  if (typeof cuerpo.campo !== "string" || (cuerpo.decision !== "confirmado" && cuerpo.decision !== "revisar")) {
    return c.json({ error: "Indica el campo y la decisión («confirmado» o «revisar»)." }, 400)
  }
  const r = await guardarDecision(caso, cuerpo.campo, cuerpo.decision, ctxPanel(c))
  if (!r.ok) return c.json({ error: "Ese valor ya no está pendiente de confirmación." }, 422)
  const v = await vistaCaso(caso, ctxPanel(c), fecha)
  return c.json({ caso: v.ok ? v.data : null })
})

app.post("/api/casos/:caso/proponer-envio", async (c) => {
  const caso = c.req.param("caso")
  const cuerpo = (await c.req.json().catch(() => ({}))) as { sessionId?: unknown; fecha?: unknown }
  const fecha = fechaPedida(typeof cuerpo.fecha === "string" ? cuerpo.fecha : undefined)
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  if (!(await casoValido(caso))) return c.json({ error: "No encontré ese caso." }, 404)
  if (typeof cuerpo.sessionId !== "string" || !SESION_RE.test(cuerpo.sessionId)) return c.json({ error: "sessionId inválido" }, 400)
  const limite = await limitar(c)
  if (limite) return limite
  const r = await proponerEnvioDesdePanel(dependencias(), cuerpo.sessionId, caso, fecha, usuarioDe(c))
  return r.ok ? c.json(r.respuesta) : c.json({ error: r.error }, 422)
})

app.get("/api/reporte", async (c) => {
  const fecha = fechaPedida(c.req.query("fecha"))
  if (!fecha) return c.json(FECHA_INVALIDA, 400)
  return c.json(await reporte(ctxPanel(c), fecha))
})

app.post("/api/reset", async (c) => {
  const esperada = config.adminResetKey()
  if (!esperada) return c.json({ error: "no encontrado" }, 404) // reset deshabilitado
  const recibida = c.req.header("x-reset-key") ?? ""
  if (!mismaClave(recibida, esperada)) return c.json({ error: "clave incorrecta" }, 401)
  await dependencias().storage.clean()
  return c.json({ ok: true, mensaje: "Salidas, logs y sesiones borrados. El consumo diario se conserva." })
})
