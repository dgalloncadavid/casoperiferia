// Bundle de la función de Vercel (api/index.js), que SE VERSIONA.
//   node scripts/build-vercel.mjs           → regenera api/index.js
//   node scripts/build-vercel.mjs --check   → no escribe; sale con 1 si lo versionado no coincide con las fuentes
// Corre igual con Node que con Bun.
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generarBundle } from "./bundle-vercel.mjs"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const destino = path.join(raiz, "api/index.js")
const esperado = await generarBundle(raiz)

if (process.argv.includes("--check")) {
  const actual = await readFile(destino, "utf8").catch(() => null)
  if (actual === null) {
    console.error("api/index.js no existe. Ejecuta: bun run build:vercel && git add api/index.js")
    process.exit(1)
  }
  if (actual !== esperado) {
    console.error("api/index.js está desactualizado respecto a las fuentes (src/, package.json o bun.lock).\nEjecuta: bun run build:vercel && git add api/index.js")
    process.exit(1)
  }
  console.log("api/index.js está alineado con las fuentes")
} else {
  await writeFile(destino, esperado)
  console.log(`api/index.js generado (${((await stat(destino)).size / 1e6).toFixed(1)} MB). Recuerda: git add api/index.js`)
}
