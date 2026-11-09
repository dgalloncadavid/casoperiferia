// Genera (en memoria) el bundle de la función de Vercel a partir de src/vercel.ts. Lo comparten:
//   scripts/build-vercel.mjs   → escribe api/index.js, o con --check lo compara con el versionado
//   test/vercel.test.ts        → falla si el bundle versionado no coincide con las fuentes
import { build } from "esbuild"
import path from "node:path"

export const ENCABEZADO = [
  "// Archivo generado por scripts/build-vercel.mjs — no editar a mano.",
  "// Regenerar con `bun run build:vercel` y versionar el resultado (`git add api/index.js`).",
  "// Vercel detecta las funciones de api/ ANTES del build, por eso este bundle se versiona en vez de generarse allí.",
].join("\n")

/** Devuelve el contenido exacto que debe tener api/index.js. Determinista: sin fechas ni rutas absolutas. */
export async function generarBundle(raiz) {
  const r = await build({
    entryPoints: [path.join(raiz, "src/vercel.ts")],
    outfile: path.join(raiz, "api/index.js"), // solo para resolver; no se escribe (write: false)
    write: false,
    absWorkingDir: raiz, // los marcadores de módulo son relativos a la raíz del proyecto, no al directorio desde el que se ejecute
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Algunas dependencias son CommonJS y usan require() de módulos de Node dentro de un bundle ESM.
    banner: { js: `${ENCABEZADO}\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);` },
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
  })
  const archivo = r.outputFiles[0]
  if (!archivo) throw new Error("esbuild no produjo salida")
  return archivo.text
}
