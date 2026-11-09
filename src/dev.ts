// Desarrollo local: `bun run dev` → http://localhost:3000
import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { app } from "./server"

const dev = new Hono()
dev.route("/", app)
dev.use("/*", serveStatic({ root: "./web" }))

export default { port: Number(process.env.PORT ?? 3000), fetch: dev.fetch }
