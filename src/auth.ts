import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

export interface Usuario {
  id: string
  email: string | null
}
export type Verificador = (token: string) => Promise<Usuario | null>

/**
 * AUTH=on exige iniciar sesión; AUTH=off corre la app sin login.
 * Sin definir: en Vercel es «on» (falla cerrado en producción) y en local «off».
 */
export function authActiva(): boolean {
  const v = (process.env.AUTH ?? "").trim().toLowerCase()
  if (v === "on") return true
  if (v === "off") return false
  return Boolean(process.env.VERCEL)
}

export const authConfigurada = (): boolean => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)

/** Configuración pública para el front. La clave anon es pública por diseño; la service role NUNCA sale del servidor. */
export function configPublica(): { authEnabled: boolean; supabaseUrl?: string; supabaseAnonKey?: string } {
  if (!authActiva()) return { authEnabled: false }
  return { authEnabled: true, supabaseUrl: process.env.SUPABASE_URL ?? "", supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "" }
}

const TTL_CACHE_MS = 60_000
const cache = new Map<string, { usuario: Usuario; vence: number }>()
let verificador: Verificador | null = null

/** Solo para pruebas: sustituye la verificación contra Supabase Auth. */
export function _setVerificador(v: Verificador | null): void {
  verificador = v
  cache.clear()
}

/** Valida el token con Supabase Auth (getUser). Cachea el resultado 60 s para no llamar en cada petición. */
export async function verificarToken(token: string): Promise<Usuario | null> {
  if (!token || token.length > 4096) return null
  const clave = createHash("sha256").update(token).digest("hex")
  const hit = cache.get(clave)
  if (hit && hit.vence > Date.now()) return hit.usuario

  let usuario: Usuario | null
  if (verificador) usuario = await verificador(token)
  else {
    const url = process.env.SUPABASE_URL
    const anon = process.env.SUPABASE_ANON_KEY
    if (!url || !anon) return null
    const cliente = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await cliente.auth.getUser(token)
    usuario = error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null }
  }
  if (usuario) {
    if (cache.size > 500) cache.clear()
    cache.set(clave, { usuario, vence: Date.now() + TTL_CACHE_MS })
  }
  return usuario
}
