import { readFile } from "node:fs/promises"
import path from "node:path"

let cache: { directory: string; texto: string } | null = null

/** Prompt (comportamiento) + conocimiento del proceso, ambos desde archivos Markdown. */
export async function cargarSystemPrompt(directory: string): Promise<string> {
  if (cache?.directory === directory) return cache.texto
  const prompt = await readFile(path.join(directory, "agent/prompt.md"), "utf8")
  const conocimiento = await readFile(path.join(directory, "src/knowledge/registro-proveedor.md"), "utf8")
  const texto = `${prompt.trim()}\n\n${conocimiento.trim()}\n`
  cache = { directory, texto }
  return texto
}
