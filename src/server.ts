import { createHash, timingSafeEqual } from "node:crypto"
import { Hono, type Context } from "hono"
import { manejarChat, cargarSesion, type Dependencias } from "./agent/ciclo"
import { config } from "./config"
import { CASO_RE, listarCasos } from "./core/fixtures"
import { resolverFecha } from "./core/util"
import { crearCadena, proveedoresConfigurados } from "./llm/cadena"
import { getStorage } from "./storage"

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
const INTERNOS = new Set(["log.jsonl", "estado.json"])

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

export const app = new Hono()

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
  })
})

app.post("/api/chat", async (c) => {
  const d = dependencias()
  let cuerpo: { sessionId?: unknown; message?: unknown; confirm?: unknown }
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

  const golpes = await d.storage.rateHit(`ip:${huella(ipDe(c))}`, 60).catch(() => 0)
  if (golpes > config.rateLimitPerMin()) {
    c.header("Retry-After", "60")
    return c.json({ error: `Demasiados mensajes: el límite es ${config.rateLimitPerMin()} por minuto. Espera un momento.` }, 429)
  }

  try {
    return c.json(await manejarChat(d, { sessionId, message, confirm }))
  } catch {
    return c.json({ error: "Ocurrió un error inesperado procesando el mensaje. La sesión sigue activa; intenta de nuevo." }, 500)
  }
})

app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id")
  if (!SESION_RE.test(id)) return c.json({ error: "sessionId inválido" }, 400)
  const d = dependencias()
  const s = await cargarSesion(d.storage, id)
  if (s.historial.length === 0) return c.json({ error: "sesión no encontrada" }, 404)
  return c.json({ id: s.id, creada: s.creada, historial: s.historial, pendiente: s.pendiente ?? null, tokens: s.tokens, sinModelo: s.sinModelo ?? false })
})

async function casoValido(caso: string): Promise<boolean> {
  if (!CASO_RE.test(caso)) return false
  const casos = await listarCasos({ directory: directorio(), sessionId: "descarga" })
  return casos.includes(caso)
}

app.get("/api/paquetes/:caso", async (c) => {
  const caso = c.req.param("caso")
  if (!(await casoValido(caso))) return c.json({ error: "caso no encontrado" }, 404)
  const archivos = (await dependencias().storage.list(caso)).map((a) => a.slice(caso.length + 1)).filter((a) => !INTERNOS.has(a.split("/").pop() ?? ""))
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
  const storage = dependencias().storage
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

app.post("/api/reset", async (c) => {
  const esperada = config.adminResetKey()
  if (!esperada) return c.json({ error: "no encontrado" }, 404) // reset deshabilitado
  const recibida = c.req.header("x-reset-key") ?? ""
  if (!mismaClave(recibida, esperada)) return c.json({ error: "clave incorrecta" }, 401)
  await dependencias().storage.clean()
  return c.json({ ok: true, mensaje: "Salidas, logs y sesiones borrados. El consumo diario se conserva." })
})
