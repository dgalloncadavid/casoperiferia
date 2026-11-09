// Lo ejecuta `vercel-build`. NO regenera nada: el bundle versionado (api/index.js) es la fuente.
// Solo comprueba que exista y que sea el archivo generado, para fallar con un mensaje claro si falta.
import { readFile } from "node:fs/promises"

const texto = await readFile(new URL("../api/index.js", import.meta.url), "utf8").catch(() => null)
if (texto === null || !texto.startsWith("// Archivo generado por scripts/build-vercel.mjs")) {
  console.error("Falta api/index.js (o no es el bundle generado). Ejecuta en local: bun run build:vercel && git add api/index.js")
  process.exit(1)
}
console.log(`api/index.js versionado listo (${(texto.length / 1e6).toFixed(1)} MB); vercel-build no lo reescribe.`)
