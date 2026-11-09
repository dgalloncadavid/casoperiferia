import type { Storage } from "./types"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Almacenamiento «de un usuario»: los archivos (casos, paquetes, constancias, decisiones, costos) viven bajo
 * `usuarios/<id>/`, así cada persona ve y escribe solo lo suyo y el evaluador empieza limpio.
 * Sesiones, consumo diario y límite de velocidad no se separan por ruta: sessions ya filtra por user_id y el gasto es global.
 * Sin usuario (app sin login) devuelve el almacenamiento tal cual.
 */
export function ambitoDeUsuario(base: Storage, userId: string | null | undefined): Storage {
  if (!userId) return base
  if (!UUID_RE.test(userId)) throw new Error("id de usuario inválido") // evita rutas manipuladas
  const raiz = `usuarios/${userId}`
  const ruta = (p: string) => (p === "" ? raiz : `${raiz}/${p}`)
  return {
    kind: base.kind,
    writeFile: (p, d) => base.writeFile(ruta(p), d),
    readFile: (p) => base.readFile(ruta(p)),
    exists: (p) => base.exists(ruta(p)),
    list: async (prefijo) => (await base.list(ruta(prefijo))).map((a) => a.slice(raiz.length + 1)),
    appendLog: (e) => base.appendLog({ ...e, userId: e.userId ?? userId }),
    readLogs: (caso) => base.readLogs(caso, userId),
    saveSession: (id, data, uid) => base.saveSession(id, data, uid ?? userId),
    loadSession: (id) => base.loadSession(id),
    listSessions: (uid, limite) => base.listSessions(uid, limite),
    addUsage: (dia, uso) => base.addUsage(dia, uso),
    getUsage: (dia) => base.getUsage(dia),
    rateHit: (clave, ventana) => base.rateHit(clave, ventana),
    clean: () => base.clean(),
  }
}
