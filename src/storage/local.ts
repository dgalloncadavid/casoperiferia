import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { idSesionSeguro, rutaSegura, type LogEntry, type Storage } from "./types"

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
      await mkdir(path.join(this.root, entry.caso), { recursive: true })
      await appendFile(path.join(this.root, entry.caso, "log.jsonl"), linea)
    }
  }

  async readLogs(caso?: string): Promise<LogEntry[]> {
    const archivo = caso ? path.join(this.root, rutaSegura(caso), "log.jsonl") : path.join(this.root, "log.jsonl")
    try {
      const texto = await readFile(archivo, "utf8")
      return texto
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as LogEntry)
    } catch {
      return []
    }
  }

  async saveSession(id: string, data: unknown): Promise<void> {
    await this.writeFile(`sessions/${idSesionSeguro(id)}.json`, JSON.stringify(data))
  }

  async loadSession(id: string): Promise<unknown | null> {
    const bytes = await this.readFile(`sessions/${idSesionSeguro(id)}.json`)
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as unknown) : null
  }

  async clean(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }
}
