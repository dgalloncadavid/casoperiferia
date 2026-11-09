import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { idSesionSeguro, rutaSegura, type LogEntry, type SesionGuardada, type Storage, type UsoDiario } from "./types"

interface SobreSesion {
  userId: string | null
  updatedAt: string
  data: unknown
}

export class LocalStorage implements Storage {
  readonly kind = "local" as const

  constructor(private readonly root: string) {}

  private abs(rel: string): string {
    return path.join(this.root, rutaSegura(rel))
  }

  async writeFile(rel: string, data: string | Uint8Array): Promise<void> {
    const destino = this.abs(rel)
    await mkdir(path.dirname(destino), { recursive: true })
    await writeFile(destino, data)
  }

  async readFile(rel: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.abs(rel)))
    } catch {
      return null
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel))
      return true
    } catch {
      return false
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.abs(prefix)
    const salida: string[] = []
    const recorrer = async (dir: string): Promise<void> => {
      const entradas = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entradas) {
        const completa = path.join(dir, e.name)
        if (e.isDirectory()) await recorrer(completa)
        else salida.push(path.relative(this.root, completa).split(path.sep).join("/"))
      }
    }
    await recorrer(base)
    return salida.sort()
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const linea = JSON.stringify(entry) + "\n"
    await mkdir(this.root, { recursive: true })
    await appendFile(path.join(this.root, "log.jsonl"), linea)
    if (entry.caso) {
      const dir = path.join(this.root, ...(entry.userId ? ["usuarios", entry.userId] : []), entry.caso)
      await mkdir(dir, { recursive: true })
      await appendFile(path.join(dir, "log.jsonl"), linea)
    }
  }

  async readLogs(caso?: string, userId?: string | null): Promise<LogEntry[]> {
    const base = userId ? path.join(this.root, "usuarios", rutaSegura(userId)) : this.root
    const archivo = caso ? path.join(base, rutaSegura(caso), "log.jsonl") : path.join(this.root, "log.jsonl")
    try {
      const texto = await readFile(archivo, "utf8")
      return texto
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as LogEntry)
        .filter((l) => !userId || l.userId === userId)
    } catch {
      return []
    }
  }

  async saveSession(id: string, data: unknown, userId?: string | null): Promise<void> {
    // Sobre equivalente a las columnas de Supabase: dueño y fecha viajan junto a los datos.
    const sobre: SobreSesion = { userId: userId ?? null, updatedAt: new Date().toISOString(), data }
    await this.writeFile(`sessions/${idSesionSeguro(id)}.json`, JSON.stringify(sobre))
  }

  async listSessions(userId: string | null, limite = 50): Promise<SesionGuardada[]> {
    const filas: SesionGuardada[] = []
    for (const archivo of (await this.list("sessions")).filter((a) => a.endsWith(".json"))) {
      const bytes = await this.readFile(archivo)
      if (!bytes) continue
      const sobre = JSON.parse(new TextDecoder().decode(bytes)) as SobreSesion
      if ((sobre.userId ?? null) !== (userId ?? null)) continue
      const id = archivo.replace(/^sessions\//, "").replace(/\.json$/, "")
      const resumen = typeof sobre.data === "object" && sobre.data !== null ? (sobre.data as { resumen?: unknown }).resumen ?? null : null
      filas.push({ id, updatedAt: sobre.updatedAt, resumen })
    }
    return filas.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, limite)
  }

  async loadSession(id: string): Promise<unknown | null> {
    const bytes = await this.readFile(`sessions/${idSesionSeguro(id)}.json`)
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as SobreSesion).data : null
  }

  private readonly golpes = new Map<string, number[]>()

  async getUsage(dia: string): Promise<UsoDiario> {
    const vacio: UsoDiario = { tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, peticiones: 0 }
    const bytes = await this.readFile(`usage/${rutaSegura(dia)}.json`)
    return bytes ? { ...vacio, ...(JSON.parse(new TextDecoder().decode(bytes)) as Partial<UsoDiario>) } : vacio
  }

  async addUsage(dia: string, uso: UsoDiario): Promise<UsoDiario> {
    const a = await this.getUsage(dia)
    const total: UsoDiario = {
      tokensEntrada: a.tokensEntrada + uso.tokensEntrada,
      tokensSalida: a.tokensSalida + uso.tokensSalida,
      costoUsd: a.costoUsd + uso.costoUsd,
      peticiones: a.peticiones + uso.peticiones,
    }
    await this.writeFile(`usage/${rutaSegura(dia)}.json`, JSON.stringify(total))
    return total
  }

  async rateHit(clave: string, ventanaSeg: number): Promise<number> {
    const ahora = Date.now()
    const vivos = (this.golpes.get(clave) ?? []).filter((t) => ahora - t < ventanaSeg * 1000)
    vivos.push(ahora)
    this.golpes.set(clave, vivos)
    return vivos.length
  }

  async clean(): Promise<void> {
    const entradas = await readdir(this.root).catch(() => [])
    for (const e of entradas) if (e !== "usage") await rm(path.join(this.root, e), { recursive: true, force: true })
  }
}
