// Comprueba que los modelos configurados existen en tu cuenta de cada proveedor.
// Uso: bun scripts/check-models.ts   (lee las claves de .env; nunca las imprime)
interface Item { id: string }

async function listar(nombre: string, baseUrl: string, apiKey: string | undefined, modelo: string, preferidos: RegExp): Promise<void> {
  if (!apiKey) return console.log(`${nombre}: sin clave en .env → omitido`)
  const res = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return console.log(`${nombre}: no se pudo listar modelos (HTTP ${res.status}). ¿Clave válida y con acceso?`)
  const ids = ((await res.json()) as { data?: Item[] }).data?.map((m) => m.id.replace(/^models\//, "")) ?? []
  const existe = ids.includes(modelo)
  console.log(`${nombre}: ${modelo} → ${existe ? "DISPONIBLE" : "NO disponible en esta cuenta"}`)
  if (!existe) console.log(`  candidatos económicos: ${ids.filter((i) => preferidos.test(i)).sort().join(", ") || "(ninguno)"}`)
}

await listar("openai", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-4.1-mini", /mini|nano/)
await listar("google", process.env.GOOGLE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai", process.env.GOOGLE_API_KEY, process.env.GOOGLE_MODEL ?? "gemini-2.5-flash", /flash/)
export {}
