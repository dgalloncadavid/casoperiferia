// Punto de entrada para Vercel (Node). vercel.json reenvía /api/* a esta función.
import { handle } from "hono/vercel"
import { app } from "../src/server"

const handler = handle(app)
export const GET = handler
export const POST = handler
