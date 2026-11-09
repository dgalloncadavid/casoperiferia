import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { ENCABEZADO, generarBundle } from "../scripts/bundle-vercel.mjs"

const raiz = path.resolve(import.meta.dirname, "..")
const bundle = path.join(raiz, "api/index.js")
const base = path.join(raiz, "out", `test-vercel-${process.pid}`)
afterAll(() => rm(base, { recursive: true, force: true }))

const hash = (t: string) => createHash("sha256").update(t).digest("hex")

describe("bundle de la función de Vercel (api/index.js, versionado)", () => {
  test("el bundle versionado es exactamente el que generan las fuentes (si falla: bun run build:vercel && git add api/index.js)", async () => {
    const [versionado, generado] = [await readFile(bundle, "utf8"), await generarBundle(raiz)]
    expect(hash(versionado), "api/index.js está desactualizado respecto a src/, package.json o bun.lock").toBe(hash(generado))
  })

  test("es determinista: dos generaciones dan el mismo contenido", async () => {
    expect(hash(await generarBundle(raiz))).toBe(hash(await generarBundle(raiz)))
  })

  test("los marcadores de módulo del bundle son rutas relativas a la raíz (no dependen de dónde esté el proyecto)", async () => {
    const t = await readFile(bundle, "utf8")
    const marcas = [...t.matchAll(/^\/\/ (\S+\.(?:ts|js|mjs|cjs|json))$/gm)].map((m) => m[1] as string)
    expect(marcas.length).toBeGreaterThan(100)
    const malas = marcas.filter((m) => m.startsWith("/") || m.startsWith("../") || /^[A-Za-z]:/.test(m))
    expect(malas).toEqual([])
    expect(marcas).toContain("src/server.ts")
    expect(marcas).toContain("src/vercel.ts")
  })

  test("el resultado no depende del directorio desde el que se ejecute el script (check:vercel pasa desde fuera de la raíz)", () => {
    for (const cwd of [path.join(raiz, "src"), path.join(raiz, "scripts"), "/"]) {
      const r = spawnSync(process.execPath, [path.join(raiz, "scripts/build-vercel.mjs"), "--check"], { cwd, encoding: "utf8" })
      expect(r.status, `desde ${cwd}: ${r.stderr}`).toBe(0)
    }
  })

  test("empieza con el comentario «Archivo generado por scripts/… — no editar a mano»", async () => {
    const t = await readFile(bundle, "utf8")
    expect(t.startsWith(ENCABEZADO)).toBe(true)
    expect(t.split("\n")[0]).toBe("// Archivo generado por scripts/build-vercel.mjs — no editar a mano.")
  })

  test("sin rutas absolutas de ninguna máquina ni de este proyecto, y sin sourcemaps ni fechas de generación", async () => {
    const t = await readFile(bundle, "utf8")
    expect(t.includes(raiz)).toBe(false)
    expect(t).not.toMatch(/\/Users\/[^/\s"']+\/|\/home\/[^/\s"']+\/|[A-Z]:\\Users|\/private\/(var|tmp)\//)
    expect(t).not.toContain("sourceMappingURL")
  })

  test("exporta GET, POST y DELETE (los métodos que Vercel invoca)", async () => {
    const t = await readFile(bundle, "utf8")
    const exportado = /export \{([^}]*)\}\s*;?\s*$/m.exec(t)?.[1] ?? ""
    for (const m of ["GET", "POST", "DELETE"]) expect(exportado, `falta export ${m}`).toMatch(new RegExp(`\\b${m}\\b`))
  })

  test("vercel.json apunta a api/index.js y ese archivo está versionado (no ignorado): Vercel detecta api/ antes del build", async () => {
    const cfg = JSON.parse(await readFile(path.join(raiz, "vercel.json"), "utf8")) as { functions: Record<string, { maxDuration: number; includeFiles: string }> }
    expect(Object.keys(cfg.functions)).toEqual(["api/index.js"])
    expect(cfg.functions["api/index.js"]).toMatchObject({ maxDuration: 60 })
    expect(cfg.functions["api/index.js"]?.includeFiles).toContain("fixtures/**")
    expect((await stat(bundle)).isFile()).toBe(true)
    const git = spawnSync("git", ["ls-files", "--error-unmatch", "api/index.js"], { cwd: raiz, encoding: "utf8" })
    if (git.error) return // sin git (p. ej. un zip): no se puede comprobar
    expect(git.status, "api/index.js no está versionado: git add api/index.js").toBe(0)
    expect(spawnSync("git", ["check-ignore", "-q", "api/index.js"], { cwd: raiz }).status, "api/index.js no debe estar en .gitignore").toBe(1)
  })

  test("«vercel-build» no reescribe el bundle: solo verifica que exista", async () => {
    const pkg = JSON.parse(await readFile(path.join(raiz, "package.json"), "utf8")) as { scripts: Record<string, string> }
    expect(pkg.scripts["vercel-build"]).toBe("node scripts/verify-vercel.mjs")
    const [antes, mtime] = [hash(await readFile(bundle, "utf8")), (await stat(bundle)).mtimeMs]
    const r = spawnSync(process.execPath, ["scripts/verify-vercel.mjs"], { cwd: raiz, encoding: "utf8" })
    expect(r.status, r.stderr).toBe(0)
    expect([hash(await readFile(bundle, "utf8")), (await stat(bundle)).mtimeMs]).toEqual([antes, mtime])
  })

  test("check:vercel falla (código 1) si falta el bundle o está desactualizado, y pasa si coincide", async () => {
    // Cada caso vive en su propia carpeta; el bundle «bueno» se genera allí mismo (los marcadores dependen del enlace a node_modules).
    const caso = async (nombre: string, modificar: ((bueno: string) => string) | null) => {
      const d = path.join(base, nombre)
      await mkdir(path.join(d, "api"), { recursive: true })
      for (const rel of ["src", "scripts", "package.json", "tsconfig.json"]) await cp(path.join(raiz, rel), path.join(d, rel), { recursive: true })
      await symlink(path.join(raiz, "node_modules"), path.join(d, "node_modules"))
      if (modificar) await writeFile(path.join(d, "api/index.js"), modificar(await generarBundle(d)))
      return spawnSync(process.execPath, ["scripts/build-vercel.mjs", "--check"], { cwd: d, encoding: "utf8" })
    }
    expect((await caso("ok", (b) => b)).status).toBe(0)
    const viejo = await caso("viejo", (b) => b + "\n// retoque a mano")
    expect(viejo.status).toBe(1)
    expect(viejo.stderr).toContain("desactualizado")
    const faltante = await caso("falta", null)
    expect(faltante.status).toBe(1)
    expect(faltante.stderr).toContain("no existe")
    const verificar = spawnSync(process.execPath, ["scripts/verify-vercel.mjs"], { cwd: path.join(base, "falta"), encoding: "utf8" })
    expect(verificar.status).toBe(1) // y en Vercel, sin bundle, el build falla con un mensaje claro
  })

  test("el bundle versionado arranca con Node y responde /api/health y la bandeja", () => {
    const codigo = `const { GET } = await import(${JSON.stringify(bundle)}); const h = await GET(new Request("http://x/api/health")); const b = await GET(new Request("http://x/api/casos?fecha=2026-09-03")); console.log(JSON.stringify([h.status, b.status, (await h.json()).ok]))`
    const { OUT_DIR: _o, VERCEL: _v, ...limpio } = process.env
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], {
      cwd: raiz,
      encoding: "utf8",
      env: { ...limpio, AUTH: "off", STORAGE: "local", OUT_DIR: path.join(base, "out-bundle"), OPENAI_API_KEY: "", GOOGLE_API_KEY: "", DEEPSEEK_API_KEY: "" },
    })
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout.trim().split("\n").pop() as string)).toEqual([200, 200, true])
  })
})
