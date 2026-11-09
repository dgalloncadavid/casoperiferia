// Entrada de la función de Vercel. `bun run vercel-build` la empaqueta (con todas sus dependencias) en api/index.js,
// para no depender de que Vercel resuelva imports sin extensión en un proyecto "type": "module".
import { handle } from "hono/vercel"
import { app } from "./server"

const handler = handle(app)
export const GET = handler
export const POST = handler
export const DELETE = handler
