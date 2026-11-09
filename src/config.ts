/** Configuración leída de variables de entorno en cada uso (nada fijo en el código). */
const num = (v: string | undefined, defecto: number): number => {
  const n = Number(v)
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : defecto
}

export const config = {
  llmChain: () =>
    (process.env.LLM_CHAIN ?? "openai,google")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  llmTimeoutMs: () => num(process.env.LLM_TIMEOUT_MS, 25_000),
  sessionTokenCap: () => num(process.env.SESSION_TOKEN_CAP, 60_000),
  maxIterations: () => num(process.env.MAX_ITERATIONS, 25),
  globalDailyUsdCap: () => num(process.env.GLOBAL_DAILY_USD_CAP, 5),
  rateLimitPerMin: () => num(process.env.RATE_LIMIT_PER_MIN, 20),
  adminResetKey: () => process.env.RESET_KEY ?? "",
  maxMessageChars: () => num(process.env.MAX_MESSAGE_CHARS, 2000),
}
