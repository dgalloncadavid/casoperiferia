// Comprueba que cada modelo configurado existe Y responde con herramientas en tu cuenta.
// Uso: bun scripts/check-models.ts   (lee las claves de .env; nunca las imprime)
// Listar modelos no basta: un modelo puede aparecer en la lista y rechazar cuentas nuevas.
interface Item {
  id: string
}

const HERRAMIENTA = {
  type: "function",
  function: {
    name: "proveedor_leer_solicitud",
    description: "Lee la solicitud del caso",
    parameters: { type: "object", properties: { caso: { type: "string", description: "nombre del caso" } }, required: ["caso"] },
  },
}

async function probar(baseUrl: string, apiKey: string, modelo: string): Promise<string> {
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelo, messages: [{ role: "user", content: "Procesa el caso ec-corp-andina" }], tools: [HERRAMIENTA], tool_choice: "auto" }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null)
    if (!res) return "sin respuesta (red o timeout)"
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    const cuerpo = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { tool_calls?: { function?: { name?: string } }[] } }[]
      error?: { message?: string }
    }
    if (!res.ok) return `HTTP ${res.status}: ${(cuerpo.error?.message ?? "").slice(0, 140)}`
    const llamada = cuerpo.choices?.[0]?.message?.tool_calls?.[0]?.function?.name
    return llamada ? `llama herramientas (${llamada})` : "responde pero NO llamó la herramienta"
  }
  return "HTTP 503 repetido (alta demanda del proveedor)"
}

async function listar(nombre: string, baseUrl: string, apiKey: string | undefined, modelo: string, preferidos: RegExp): Promise<void> {
  if (!apiKey) return console.log(`${nombre}: sin clave en .env → omitido`)
  const res = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return console.log(`${nombre}: no se pudo listar modelos (HTTP ${res.status}). ¿Clave válida y con acceso?`)
  const ids = ((await res.json()) as { data?: Item[] }).data?.map((m) => m.id.replace(/^models\//, "")) ?? []
  const listado = ids.includes(modelo)
  const prueba = await probar(baseUrl, apiKey, modelo)
  const ok = prueba.startsWith("llama herramientas")
  console.log(`${ok ? "✓" : "✗"} ${nombre}: ${modelo} → ${listado ? "listado" : "NO listado"}; prueba real: ${prueba}`)
  if (!ok) console.log(`  candidatos: ${ids.filter((i) => preferidos.test(i)).sort().join(", ") || "(ninguno)"}`)
}

await listar("openai", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-4.1-mini", /mini|nano/)
await listar("google", process.env.GOOGLE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai", process.env.GOOGLE_API_KEY, process.env.GOOGLE_MODEL ?? "gemini-3.1-flash-lite", /flash/)
await listar("deepseek", process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1", process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-flash", /deepseek/)
export {}
