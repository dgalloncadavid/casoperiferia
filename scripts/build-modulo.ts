// Genera modulo/ desde las fuentes de la aplicación.
//   bun scripts/build-modulo.ts           → escribe modulo/
//   bun scripts/build-modulo.ts --check   → no escribe; sale con 1 si modulo/ está desalineado
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { diferencias, generarModulo, leerModulo } from "./modulo-lib"

const directory = path.resolve(import.meta.dirname, "..")
const esperado = await generarModulo(directory)

if (process.argv.includes("--check")) {
  const mal = diferencias(esperado, await leerModulo(directory))
  if (mal.length) {
    console.error(`modulo/ desalineado:\n- ${mal.join("\n- ")}\nEjecuta: bun run build:modulo`)
    process.exit(1)
  }
  console.log("modulo/ está alineado con la aplicación")
} else {
  await rm(path.join(directory, "modulo"), { recursive: true, force: true })
  for (const [rel, contenido] of Object.entries(esperado)) {
    const destino = path.join(directory, "modulo", rel)
    await mkdir(path.dirname(destino), { recursive: true })
    await writeFile(destino, contenido)
  }
  console.log(`modulo/ generado: ${Object.keys(esperado).join(", ")}`)
}
