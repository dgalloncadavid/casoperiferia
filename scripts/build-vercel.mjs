// Empaqueta src/vercel.ts en api/index.js (ESM, Node, todo incluido). Corre igual con Node que con Bun:
//   node scripts/build-vercel.mjs      → lo usa el script "vercel-build" (no exige Bun en el build de Vercel)
import { build } from "esbuild"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const salida = path.join(raiz, "api/index.js")

await build({
  entryPoints: [path.join(raiz, "src/vercel.ts")],
  outfile: salida,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Algunas dependencias son CommonJS y usan require() de módulos de Node dentro de un bundle ESM.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  legalComments: "none",
  logLevel: "warning",
})
console.log(`api/index.js generado (${((await stat(salida)).size / 1e6).toFixed(1)} MB)`)
