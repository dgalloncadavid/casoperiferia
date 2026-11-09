export interface LogEntry {
  ts: string
  herramienta: string
  ok: boolean
  resumen: string
  caso: string | null
  sessionId?: string
  /** uuid del usuario autenticado (null si la app corre sin login). */
  userId?: string | null
}

export interface SesionGuardada {
  id: string
  /** ISO 8601 de la última actualización. */
  updatedAt: string
  resumen: unknown
}

export interface UsoDiario {
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
  peticiones: number
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
  /** Logs de un caso (o todos); con `userId`, solo los de ese usuario. */
  readLogs(caso?: string, userId?: string | null): Promise<LogEntry[]>
  saveSession(id: string, data: unknown, userId?: string | null): Promise<void>
  loadSession(id: string): Promise<unknown | null>
  /** Sesiones de ESE usuario (null = sin login), las más recientes primero. Siempre filtra en el almacenamiento. */
  listSessions(userId: string | null, limite?: number): Promise<SesionGuardada[]>
  /** Suma al consumo global del día (AAAA-MM-DD, UTC) y devuelve el total. */
  addUsage(dia: string, uso: UsoDiario): Promise<UsoDiario>
  getUsage(dia: string): Promise<UsoDiario>
  /** Cuenta un golpe en la ventana de `ventanaSeg`; devuelve cuántos van (incluido este). */
  rateHit(clave: string, ventanaSeg: number): Promise<number>
  /** Borra salidas, logs y sesiones. NO borra el consumo global. */
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
