import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { idSesionSeguro, rutaSegura, type LogEntry, type SesionGuardada, type Storage, type UsoDiario } from "./types"

const TIPOS: Record<string, string> = {
  md: "text/markdown",
  json: "application/json",
  txt: "text/plain",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

interface FilaLog {
  ts: string
  caso: string | null
  session_id: string | null
  user_id?: string | null
  herramienta: string
  ok: boolean
  resumen: string
}

/** Sesiones y logs en tablas de Postgres; paquetes en Supabase Storage. */
export class SupabaseStorage implements Storage {
  readonly kind = "supabase" as const
  private readonly client: SupabaseClient

  constructor(url: string, serviceKey: string, private readonly bucket: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } })
  }

  private get bucketApi() {
    return this.client.storage.from(this.bucket)
  }

  async writeFile(rel: string, data: string | Uint8Array): Promise<void> {
    const ruta = rutaSegura(rel)
    const ext = ruta.split(".").pop() ?? ""
    const cuerpo = typeof data === "string" ? new TextEncoder().encode(data) : data
    const { error } = await this.bucketApi.upload(ruta, cuerpo, {
      upsert: true,
      contentType: TIPOS[ext] ?? "application/octet-stream",
    })
    if (error) throw new Error(`no se pudo guardar el archivo: ${error.message}`)
  }

  async readFile(rel: string): Promise<Uint8Array | null> {
    const { data, error } = await this.bucketApi.download(rutaSegura(rel))
    if (error || !data) return null
    return new Uint8Array(await data.arrayBuffer())
  }

  async exists(rel: string): Promise<boolean> {
    const ruta = rutaSegura(rel)
    const i = ruta.lastIndexOf("/")
    const carpeta = i >= 0 ? ruta.slice(0, i) : ""
    const nombre = ruta.slice(i + 1)
    const { data, error } = await this.bucketApi.list(carpeta, { search: nombre })
    if (error || !data) return false
    return data.some((f) => f.name === nombre)
  }

  async list(prefix: string): Promise<string[]> {
    const salida: string[] = []
    const recorrer = async (carpeta: string): Promise<void> => {
      const { data } = await this.bucketApi.list(carpeta, { limit: 1000 })
      for (const f of data ?? []) {
        const completa = carpeta ? `${carpeta}/${f.name}` : f.name
        if (f.id === null) await recorrer(completa)
        else salida.push(completa)
      }
    }
    await recorrer(prefix.replace(/\/$/, ""))
    return salida.sort()
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const fila: FilaLog = {
      ts: entry.ts,
      caso: entry.caso,
      session_id: entry.sessionId ?? null,
      user_id: entry.userId ?? null,
      herramienta: entry.herramienta,
      ok: entry.ok,
      resumen: entry.resumen,
    }
    const { error } = await this.client.from("logs").insert(fila)
    if (error) throw new Error(`no se pudo registrar el log: ${error.message}`)
  }

  async readLogs(caso?: string, userId?: string | null): Promise<LogEntry[]> {
    let consulta = this.client.from("logs").select("*").order("ts", { ascending: true })
    if (caso) consulta = consulta.eq("caso", caso)
    if (userId) consulta = consulta.eq("user_id", userId)
    const { data, error } = await consulta
    if (error || !data) return []
    return (data as FilaLog[]).map((f) => ({
      ts: f.ts,
      caso: f.caso,
      sessionId: f.session_id ?? undefined,
      userId: f.user_id ?? null,
      herramienta: f.herramienta,
      ok: f.ok,
      resumen: f.resumen,
    }))
  }

  async saveSession(id: string, data: unknown, userId?: string | null): Promise<void> {
    const { error } = await this.client
      .from("sessions")
      .upsert({ id: idSesionSeguro(id), data, user_id: userId ?? null, updated_at: new Date().toISOString() })
    if (error) throw new Error(`no se pudo guardar la sesión: ${error.message}`)
  }

  async loadSession(id: string): Promise<unknown | null> {
    const { data } = await this.client.from("sessions").select("data").eq("id", idSesionSeguro(id)).maybeSingle()
    return data ? (data as { data: unknown }).data : null
  }

  async listSessions(userId: string | null, limite = 50): Promise<SesionGuardada[]> {
    // Solo se trae el resumen (no el historial completo) y siempre filtrado por usuario.
    const base = this.client.from("sessions").select("id, updated_at, resumen:data->resumen")
    const filtrada = userId === null ? base.is("user_id", null) : base.eq("user_id", userId)
    const { data, error } = await filtrada.order("updated_at", { ascending: false }).limit(limite)
    if (error || !data) return []
    return (data as { id: string; updated_at: string; resumen: unknown }[]).map((f) => ({ id: f.id, updatedAt: f.updated_at, resumen: f.resumen }))
  }

  async addUsage(dia: string, uso: UsoDiario): Promise<UsoDiario> {
    const { data, error } = await this.client.rpc("add_usage", {
      p_dia: dia,
      p_entrada: uso.tokensEntrada,
      p_salida: uso.tokensSalida,
      p_costo: uso.costoUsd,
      p_peticiones: uso.peticiones,
    })
    if (error) throw new Error(`no se pudo registrar el consumo: ${error.message}`)
    return filaUso(data)
  }

  async getUsage(dia: string): Promise<UsoDiario> {
    const { data } = await this.client.from("usage").select("*").eq("dia", dia).maybeSingle()
    return filaUso(data)
  }

  async rateHit(clave: string, ventanaSeg: number): Promise<number> {
    const { data, error } = await this.client.rpc("rate_hit", { p_clave: clave, p_ventana_seg: ventanaSeg })
    if (error) throw new Error(`no se pudo aplicar el límite de velocidad: ${error.message}`)
    return Number(data)
  }

  async clean(): Promise<void> {
    const archivos = await this.list("")
    for (let i = 0; i < archivos.length; i += 100) {
      await this.bucketApi.remove(archivos.slice(i, i + 100))
    }
    await this.client.from("logs").delete().gte("id", 0)
    await this.client.from("sessions").delete().neq("id", "")
  }
}

function filaUso(fila: unknown): UsoDiario {
  const f = (Array.isArray(fila) ? fila[0] : fila) as Record<string, unknown> | null | undefined
  return {
    tokensEntrada: Number(f?.tokens_entrada ?? 0),
    tokensSalida: Number(f?.tokens_salida ?? 0),
    costoUsd: Number(f?.costo_usd ?? 0),
    peticiones: Number(f?.peticiones ?? 0),
  }
}
