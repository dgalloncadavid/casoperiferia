export interface LogEntry {
  ts: string
  herramienta: string
  ok: boolean
  resumen: string
  caso: string | null
  sessionId?: string
}

/**
 * Almacenamiento de salidas (paquetes), logs y sesiones.
 * Las rutas son relativas a la raíz de salida: "<caso>/paquete/checklist.md".
 */
export interface Storage {
  readonly kind: "local" | "supabase"
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array | null>
  exists(path: string): Promise<boolean>
  list(prefix: string): Promise<string[]>
  appendLog(entry: LogEntry): Promise<void>
  readLogs(caso?: string): Promise<LogEntry[]>
  saveSession(id: string, data: unknown): Promise<void>
  loadSession(id: string): Promise<unknown | null>
  clean(): Promise<void>
}

export function rutaSegura(path: string): string {
  const limpia = path.replace(/\\/g, "/")
  const partes = limpia.split("/")
  if (limpia.startsWith("/") || partes.some((p) => p === ".." || p === "")) {
    throw new Error("ruta de almacenamiento inválida")
  }
  return limpia
}

export function idSesionSeguro(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("id de sesión inválido")
  return id
}
