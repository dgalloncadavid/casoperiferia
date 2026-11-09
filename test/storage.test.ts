import { describe, expect, test } from "bun:test"
import { createClient } from "@supabase/supabase-js"
import path from "node:path"
import { LocalStorage } from "../src/storage"
import { SupabaseStorage } from "../src/storage/supabase"
import type { Storage } from "../src/storage/types"

const directory = path.resolve(import.meta.dirname, "..")
const marca = `zz-test-${Date.now()}`

/** Contrato común. Usa solo claves con prefijo propio para no tocar datos reales. */
function contrato(nombre: string, crear: () => Storage, limpiar?: () => Promise<void>) {
  describe(`Storage ${nombre}`, () => {
    test("archivos: escribir, leer binario, existe, listar y rechazar rutas fuera de la raíz", async () => {
      const s = crear()
      const bin = new Uint8Array([0, 1, 2, 250, 255])
      await s.writeFile(`${marca}/paquete/a.bin`, bin)
      await s.writeFile(`${marca}/paquete/b.md`, "# hola ñ")
      expect(Array.from((await s.readFile(`${marca}/paquete/a.bin`)) ?? [])).toEqual(Array.from(bin))
      expect(new TextDecoder().decode((await s.readFile(`${marca}/paquete/b.md`)) ?? new Uint8Array())).toBe("# hola ñ")
      expect(await s.exists(`${marca}/paquete/b.md`)).toBe(true)
      expect(await s.exists(`${marca}/paquete/no.md`)).toBe(false)
      expect(await s.readFile(`${marca}/paquete/no.md`)).toBeNull()
      expect(await s.list(marca)).toEqual([`${marca}/paquete/a.bin`, `${marca}/paquete/b.md`])
      await expect(s.writeFile("../fuera.txt", "x")).rejects.toThrow()
    })
    test("logs: global y por caso", async () => {
      const s = crear()
      await s.appendLog({ ts: new Date().toISOString(), herramienta: "proveedor_prueba", ok: true, resumen: "r", caso: marca, sessionId: "s1" })
      const porCaso = await s.readLogs(marca)
      expect(porCaso.at(-1)).toMatchObject({ herramienta: "proveedor_prueba", ok: true, caso: marca })
    })
    test("sesiones: guardar, cargar, inexistente y id inválido", async () => {
      const s = crear()
      await s.saveSession(`${marca}-ses`, { a: 1, pendiente: { caso: "x" } })
      expect(await s.loadSession(`${marca}-ses`)).toEqual({ a: 1, pendiente: { caso: "x" } })
      expect(await s.loadSession(`${marca}-nada`)).toBeNull()
      await expect(s.saveSession("../x", {})).rejects.toThrow()
    })
    test("consumo diario: suma de forma acumulativa", async () => {
      const s = crear()
      const dia = "2000-01-01"
      const antes = await s.getUsage(dia)
      const total = await s.addUsage(dia, { tokensEntrada: 10, tokensSalida: 5, costoUsd: 0.25, peticiones: 1 })
      expect(total.tokensEntrada).toBe(antes.tokensEntrada + 10)
      expect(total.costoUsd).toBeCloseTo(antes.costoUsd + 0.25, 8)
      const otra = await s.addUsage(dia, { tokensEntrada: 1, tokensSalida: 1, costoUsd: 0.5, peticiones: 1 })
      expect(otra.peticiones).toBe(antes.peticiones + 2)
      expect((await s.getUsage(dia)).costoUsd).toBeCloseTo(antes.costoUsd + 0.75, 8)
    })
    test("límite de velocidad: cuenta dentro de la ventana", async () => {
      const s = crear()
      const k = `${marca}-ip`
      expect(await s.rateHit(k, 60)).toBe(1)
      expect(await s.rateHit(k, 60)).toBe(2)
      expect(await s.rateHit(k, 60)).toBe(3)
    })
    if (limpiar) test("limpieza de lo creado por la prueba", limpiar)
  })
}

contrato("local", () => new LocalStorage(path.join(directory, "out", `test-storage-${process.pid}`)), async () => {
  await new LocalStorage(path.join(directory, "out", `test-storage-${process.pid}`)).clean()
})

const url = process.env.SUPABASE_URL
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
if (url && clave) {
  const bucket = process.env.SUPABASE_BUCKET ?? "paquetes"
  contrato("supabase (proyecto real)", () => new SupabaseStorage(url, clave, bucket), async () => {
    const c = createClient(url, clave, { auth: { persistSession: false } })
    const archivos = await new SupabaseStorage(url, clave, bucket).list(marca)
    if (archivos.length) await c.storage.from(bucket).remove(archivos)
    await c.from("logs").delete().eq("caso", marca)
    await c.from("sessions").delete().like("id", `${marca}%`)
    await c.from("usage").delete().eq("dia", "2000-01-01")
    await c.from("rate_limits").delete().like("clave", `${marca}%`)
  })
} else {
  describe("Storage supabase (proyecto real)", () => {
    test.skip("omitido: define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env", () => undefined)
  })
}
