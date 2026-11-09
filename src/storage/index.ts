import path from "node:path"
import { LocalStorage } from "./local"
import { SupabaseStorage } from "./supabase"
import type { Storage } from "./types"

export type { Storage, LogEntry } from "./types"
export { LocalStorage } from "./local"

let actual: Storage | null = null

/** Sustituye la implementación activa (demo.ts y pruebas). */
export function setStorage(s: Storage | null): void {
  actual = s
}

function crear(directory: string): Storage {
  const modo = process.env.STORAGE ?? "local"
  if (modo === "supabase") {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error("STORAGE=supabase requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY")
    return new SupabaseStorage(url, key, process.env.SUPABASE_BUCKET ?? "paquetes")
  }
  if (modo !== "local") throw new Error("STORAGE debe ser local o supabase")
  // En Vercel el disco es de solo lectura salvo /tmp.
  // `||` y no `??`: una variable vacía cuenta como no definida (si no, "" resolvería a la raíz del proyecto).
  const raiz = process.env.OUT_DIR || (process.env.VERCEL ? "/tmp/out" : "out")
  return new LocalStorage(path.resolve(directory, raiz))
}

export function getStorage(directory: string): Storage {
  if (!actual) actual = crear(directory)
  return actual
}
