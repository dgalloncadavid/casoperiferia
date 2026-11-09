import { describe, expect, test } from "bun:test"
import path from "node:path"
import { LocalStorage, ambitoDeUsuario } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const A = "aaaaaaaa-0000-4000-8000-000000000001"
const B = "bbbbbbbb-0000-4000-8000-000000000002"
const nueva = () => new LocalStorage(path.join(directory, "out", `test-ambito-${process.pid}-${Math.random().toString(36).slice(2)}`))

describe("ámbito por usuario", () => {
  test("sin usuario devuelve el mismo almacenamiento", () => {
    const base = nueva()
    expect(ambitoDeUsuario(base, null)).toBe(base)
    expect(ambitoDeUsuario(base, undefined)).toBe(base)
  })

  test("cada usuario escribe, lee y lista solo lo suyo (las rutas salen sin el prefijo)", async () => {
    const base = nueva()
    const a = ambitoDeUsuario(base, A)
    const b = ambitoDeUsuario(base, B)
    await a.writeFile("caso-x/paquete/checklist.md", "de A")
    await b.writeFile("caso-x/paquete/checklist.md", "de B")
    expect(new TextDecoder().decode((await a.readFile("caso-x/paquete/checklist.md")) as Uint8Array)).toBe("de A")
    expect(new TextDecoder().decode((await b.readFile("caso-x/paquete/checklist.md")) as Uint8Array)).toBe("de B")
    expect(await a.list("caso-x")).toEqual(["caso-x/paquete/checklist.md"])
    expect(await a.exists("caso-x/paquete/checklist.md")).toBe(true)
    expect(await base.exists("caso-x/paquete/checklist.md")).toBe(false) // la raíz compartida no se toca
    expect(await base.exists(`usuarios/${A}/caso-x/paquete/checklist.md`)).toBe(true)
    expect(await ambitoDeUsuario(base, "cccccccc-0000-4000-8000-000000000003").list("caso-x")).toEqual([])
    await base.clean()
  })

  test("un id de usuario manipulado se rechaza (no puede escapar de su carpeta)", () => {
    const base = nueva()
    for (const malo of ["../x", "a/b", "..", "no-es-uuid", `${A}/../${B}`]) expect(() => ambitoDeUsuario(base, malo)).toThrow()
  })

  test("las rutas con .. no salen del espacio del usuario", async () => {
    const base = nueva()
    const a = ambitoDeUsuario(base, A)
    await expect(a.writeFile("../" + B + "/robo.md", "x")).rejects.toThrow()
    await base.appendLog({ ts: new Date().toISOString(), herramienta: "t", ok: true, resumen: "secreto de la raíz", caso: null })
    expect(await a.readFile("../../log.jsonl")).toBeNull() // la ruta inválida no devuelve el log de la raíz
    expect(await a.exists("../../log.jsonl")).toBe(false)
    await base.clean()
  })

  test("los logs de caso quedan por usuario y readLogs los separa", async () => {
    const base = nueva()
    const a = ambitoDeUsuario(base, A)
    const b = ambitoDeUsuario(base, B)
    const entrada = (resumen: string) => ({ ts: new Date().toISOString(), herramienta: "t", ok: true, resumen, caso: "caso-x" })
    await a.appendLog(entrada("de A"))
    await b.appendLog(entrada("de B"))
    expect((await a.readLogs("caso-x")).map((l) => l.resumen)).toEqual(["de A"])
    expect((await b.readLogs("caso-x")).map((l) => l.resumen)).toEqual(["de B"])
    expect((await a.readLogs()).every((l) => l.userId === A)).toBe(true)
    expect((await base.readLogs()).length).toBe(2) // el log global ve todo (administración)
    await base.clean()
  })

  test("el consumo y el límite de velocidad siguen siendo globales", async () => {
    const base = nueva()
    const a = ambitoDeUsuario(base, A)
    const b = ambitoDeUsuario(base, B)
    await a.addUsage("2026-01-01", { tokensEntrada: 1, tokensSalida: 1, costoUsd: 1, peticiones: 1 })
    await b.addUsage("2026-01-01", { tokensEntrada: 1, tokensSalida: 1, costoUsd: 2, peticiones: 1 })
    expect((await base.getUsage("2026-01-01")).costoUsd).toBe(3)
    await base.clean()
  })
})
