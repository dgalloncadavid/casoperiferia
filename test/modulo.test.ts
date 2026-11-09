import { afterAll, describe, expect, test } from "bun:test"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { diferencias, generarModulo, leerModulo } from "../scripts/modulo-lib"
import { herramientas } from "../src/tools/proveedor"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")
const base = path.join(directory, "out", `test-modulo-${process.pid}`)
afterAll(() => rm(base, { recursive: true, force: true }))

function separar(md: string): { frontmatter: string; cuerpo: string } {
  const m = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(md)
  if (!m) throw new Error("sin frontmatter")
  return { frontmatter: m[1] as string, cuerpo: m[2] as string }
}

describe("modulo/ está alineado con la aplicación (una sola fuente de verdad)", () => {
  test("lo que hay en modulo/ es exactamente lo que generan las fuentes (si falla: bun run build:modulo)", async () => {
    const mal = diferencias(await generarModulo(directory), await leerModulo(directory))
    expect(mal, mal.join("\n")).toEqual([])
  })

  test("el cuerpo de agent.md es agent/prompt.md y el de SKILL.md es src/knowledge/registro-proveedor.md", async () => {
    const mod = await leerModulo(directory)
    const prompt = await readFile(path.join(directory, "agent/prompt.md"), "utf8")
    const conocimiento = await readFile(path.join(directory, "src/knowledge/registro-proveedor.md"), "utf8")
    expect(separar(mod["agent.md"] as string).cuerpo.trim()).toBe(prompt.trim())
    expect(separar(mod["skill/registro-proveedor/SKILL.md"] as string).cuerpo.trim()).toBe(conocimiento.trim())
  })

  test("frontmatter del PRD §9.4: agent.md (description, mode primary, edit y bash denegados) y SKILL.md (name, description)", async () => {
    const mod = await leerModulo(directory)
    const agente = separar(mod["agent.md"] as string).frontmatter
    expect(agente).toMatch(/^description: ".+"$/m)
    expect(agente).toMatch(/^mode: primary$/m)
    expect(agente).toMatch(/^permission:\n {2}edit: deny\n {2}bash: deny$/m)
    const skill = separar(mod["skill/registro-proveedor/SKILL.md"] as string).frontmatter
    expect(skill).toMatch(/^name: registro-proveedor$/m)
    expect(skill).toMatch(/^description: ".+"$/m)
  })

  test("el prompt del módulo no asume un servidor: cubre la confirmación cuando la plataforma no la impone", async () => {
    const cuerpo = separar((await leerModulo(directory))["agent.md"] as string).cuerpo
    expect(cuerpo).toContain("`confirmado`")
    expect(cuerpo).toContain("skill `registro-proveedor`")
  })

  test("el test detecta la desalineación: un cambio en las fuentes o a mano en modulo/ hace fallar la comparación", async () => {
    // 1) alguien edita modulo/ a mano
    const esperado = await generarModulo(directory)
    const real = await leerModulo(directory)
    expect(diferencias(esperado, { ...real, "agent.md": real["agent.md"] + "\nretoque a mano" })).toEqual(["modulo/agent.md difiere de lo que generan las fuentes"])
    expect(diferencias(esperado, { ...real, "extra.md": "x" })).toEqual(["sobra modulo/extra.md (no lo genera el script)"])
    const sinTools = { ...real }
    delete sinTools["tools/proveedor.ts"]
    expect(diferencias(esperado, sinTools)).toEqual(["falta modulo/tools/proveedor.ts"])

    // 2) alguien cambia las fuentes de la app y no regenera el módulo
    const fuentes = path.join(base, "fuentes-modificadas")
    await mkdir(fuentes, { recursive: true })
    for (const rel of ["agent", "src", "package.json"]) await cp(path.join(directory, rel), path.join(fuentes, rel), { recursive: true })
    await writeFile(path.join(fuentes, "agent/prompt.md"), (await readFile(path.join(directory, "agent/prompt.md"), "utf8")) + "\nRegla nueva.\n")
    const core = path.join(fuentes, "src/core/soportes.ts")
    await writeFile(core, (await readFile(core, "utf8")).replace("UMBRAL_AMARILLA = 30", "UMBRAL_AMARILLA = 45"))
    await cp(path.join(directory, "src/knowledge"), path.join(fuentes, "src/knowledge"), { recursive: true })
    const tras = diferencias(await generarModulo(fuentes), real)
    expect(tras).toContain("modulo/agent.md difiere de lo que generan las fuentes")
    expect(tras).toContain("modulo/tools/proveedor.ts difiere de lo que generan las fuentes")
  })
})

describe("modulo/tools/proveedor.ts funciona sin el servidor", () => {
  test("solo importa node:*, zod, exceljs y pdf-lib (sin Hono, Supabase ni src/)", async () => {
    const codigo = (await leerModulo(directory))["tools/proveedor.ts"] as string
    const importados = [...codigo.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1] as string)
    const permitidos = importados.filter((i) => !i.startsWith("node:"))
    expect([...new Set(permitidos)].sort()).toEqual(["exceljs", "pdf-lib", "zod"])
    expect(codigo).not.toMatch(/from "\.{1,2}\//)
    expect(codigo).not.toMatch(/hono|@supabase/i)
  })

  test("en una carpeta aislada (solo modulo/ + fixtures/, sin src/ ni agent/) da los mismos resultados que las herramientas de la app", async () => {
    const aislada = path.join(base, "anfitrion")
    await mkdir(aislada, { recursive: true })
    await cp(path.join(directory, "modulo"), path.join(aislada, "modulo"), { recursive: true })
    await cp(path.join(directory, "fixtures"), path.join(aislada, "fixtures"), { recursive: true })
    await symlink(path.join(directory, "node_modules"), path.join(aislada, "node_modules"))
    await writeFile(
      path.join(aislada, "correr.mjs"),
      `import { herramientas } from "./modulo/tools/proveedor.ts"
const ctx = { directory: process.cwd(), sessionId: "anfitrion", fechaReferencia: "2026-09-03" }
const salida = {}
for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
  const r = {}
  for (const nombre of ["leer_solicitud", "mapear_campos", "generar_formulario", "armar_paquete"]) r[nombre] = JSON.parse(await herramientas[nombre].execute({ caso }, ctx))
  salida[caso] = r
}
salida.sinConfirmar = JSON.parse(await herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: false }, ctx))
salida.confirmado = JSON.parse(await herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx))
salida.argsInvalidos = JSON.parse(await herramientas.leer_solicitud.execute({}, ctx))
console.log(JSON.stringify(salida))
`,
    )
    const { OUT_DIR: _o, VERCEL: _v, ...limpio } = process.env
    const entorno = { ...limpio, STORAGE: "local" }
    const hijo = spawnSync(process.execPath, ["correr.mjs"], { cwd: aislada, env: entorno, encoding: "utf8" })
    expect(hijo.status, hijo.stderr).toBe(0)
    const delModulo = JSON.parse(hijo.stdout) as Record<string, Record<string, unknown>>

    // Lo mismo, con las herramientas de la app, en su propio almacenamiento
    const storage = new LocalStorage(path.join(base, "out-app"))
    setStorage(storage)
    const ctx = { directory, sessionId: "app", fechaReferencia: "2026-09-03" }
    for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
      for (const nombre of ["leer_solicitud", "mapear_campos", "generar_formulario", "armar_paquete"] as const) {
        const deApp = JSON.parse(await herramientas[nombre].execute({ caso }, ctx)) as unknown
        expect(delModulo[caso]?.[nombre], `${caso}/${nombre}`).toEqual(deApp)
      }
    }
    // Resultados clave (tabla del reto) y archivos reales en el anfitrión
    const ec = delModulo["ec-corp-andina"] as Record<string, { data?: { estado_firma?: string; conteo?: { llenos: number } } }>
    expect(ec.armar_paquete?.data?.estado_firma).toBe("bloqueado")
    expect(ec.mapear_campos?.data?.conteo?.llenos).toBe(13)
    const fs = await import("node:fs/promises")
    expect((await fs.stat(path.join(aislada, "out/co-industrias-delta/formulario.xlsx"))).size).toBeGreaterThan(1000)
    expect((await fs.stat(path.join(aislada, "out/ec-corp-andina/paquete/checklist.md"))).size).toBeGreaterThan(100)
    // Confirmación y errores: contrato intacto, nunca lanza
    expect(delModulo.sinConfirmar).toEqual({ ok: false, error: "requiere confirmación explícita", codigo: "requiere_confirmacion" })
    expect((delModulo.confirmado as { ok: boolean }).ok).toBe(true)
    expect(delModulo.argsInvalidos).toMatchObject({ ok: false, codigo: "argumentos_invalidos" })
    // No arrastró nada del servidor: la carpeta anfitriona no tiene src/ ni agent/
    await expect(fs.stat(path.join(aislada, "src"))).rejects.toThrow()
    await expect(fs.stat(path.join(aislada, "agent"))).rejects.toThrow()
  })

  test("STORAGE=supabase en el módulo no lanza ni necesita Supabase: la herramienta que escribe devuelve {ok:false}", async () => {
    const aislada = path.join(base, "anfitrion")
    const hijo = spawnSync(
      process.execPath,
      ["-e", `import { herramientas } from "./modulo/tools/proveedor.ts"; console.log(await herramientas.armar_paquete.execute({ caso: "ec-corp-andina" }, { directory: process.cwd(), sessionId: "x" }))`],
      { cwd: aislada, env: { ...process.env, STORAGE: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }, encoding: "utf8" },
    )
    expect(hijo.status, hijo.stderr).toBe(0)
    expect(JSON.parse(hijo.stdout)).toMatchObject({ ok: false, codigo: "error_interno" })
  })
})
