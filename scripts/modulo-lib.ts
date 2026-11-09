// Genera el contenido de modulo/ a partir de las piezas que usa la aplicación (única fuente de verdad):
//   agent/prompt.md                 → modulo/agent.md (cuerpo)
//   src/knowledge/registro-proveedor.md → modulo/skill/registro-proveedor/SKILL.md (cuerpo)
//   src/tools/proveedor.ts (+ src/core, src/storage) → modulo/tools/proveedor.ts (un solo archivo)
// Nada en modulo/ se edita a mano: lo escribe scripts/build-modulo.ts y lo vigila test/modulo.test.ts.
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const AVISO = "GENERADO por scripts/build-modulo.ts desde las fuentes de la aplicación. No editar a mano: se pierde al regenerar y test/modulo.test.ts falla si se desalinea."

export const DESCRIPCION_AGENTE =
  "Prepara el registro de Periferia como proveedor ante clientes: lee la solicitud, llena el formulario desde el maestro, arma el paquete para firma y pide confirmación humana. Nunca firma ni envía."
export const DESCRIPCION_SKILL =
  "Conocimiento del proceso de registro como proveedor: qué pide cada país, estados de un campo, vigencia de soportes, datos bancarios, portales y paquete para firma."

const leer = (directory: string, rel: string) => readFile(path.join(directory, rel), "utf8")

function agenteMd(prompt: string): string {
  return [
    "---",
    `# ${AVISO}`,
    `description: ${JSON.stringify(DESCRIPCION_AGENTE)}`,
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
    prompt.trim(),
    "",
  ].join("\n")
}

function skillMd(conocimiento: string): string {
  return [
    "---",
    `# ${AVISO}`,
    "name: registro-proveedor",
    `description: ${JSON.stringify(DESCRIPCION_SKILL)}`,
    "---",
    "",
    conocimiento.trim(),
    "",
  ].join("\n")
}

/** Empaqueta las herramientas y todo lo que usan en un solo archivo, sin servidor y sin Supabase. */
async function empaquetarHerramientas(directory: string): Promise<string> {
  const resultado = await Bun.build({
    entrypoints: [path.join(directory, "src/tools/proveedor.ts")],
    target: "node",
    format: "esm",
    external: ["zod", "exceljs", "pdf-lib"],
    plugins: [
      {
        // El módulo guarda en disco local; el backend de Supabase pertenece a la aplicación desplegada.
        name: "sin-supabase",
        setup(build) {
          build.onResolve({ filter: /\/supabase$/ }, () => ({ path: "supabase-no-incluido", namespace: "stub" }))
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents:
              'export class SupabaseStorage { constructor() { throw new Error("El módulo empaquetado solo incluye almacenamiento local (STORAGE=local). Supabase pertenece a la aplicación desplegada.") } }',
          }))
        },
      },
    ],
  })
  if (!resultado.success || resultado.outputs.length !== 1) {
    throw new Error(`no se pudo empaquetar src/tools/proveedor.ts: ${resultado.logs.map(String).join("; ")}`)
  }
  const codigo = await (resultado.outputs[0] as Blob).text()
  return `// @ts-nocheck\n// ${AVISO}\n${codigo.trimEnd()}\n`
}

function readmeModulo(): string {
  return `# Módulo reutilizable: agente de registro como proveedor

> ${AVISO}

Tres piezas, las mismas que usa la aplicación, para integrar el agente en otras plataformas de agentes **sin depender del servidor**:

| Pieza | Para qué |
|---|---|
| [agent.md](agent.md) | Definición del agente (frontmatter con \`mode: primary\` y permisos \`edit: deny\`, \`bash: deny\`). El cuerpo es el system prompt. |
| [skill/registro-proveedor/SKILL.md](skill/registro-proveedor/SKILL.md) | El conocimiento del proceso (qué pide cada país, vigencias, reglas). |
| [tools/proveedor.ts](tools/proveedor.ts) | Las 5 herramientas \`proveedor_*\` en un solo archivo. Cada export \`<x>\` se expone como \`proveedor_<x>\`. |

## Uso

1. Instala las dependencias: \`bun install\` (o \`npm install\`) con el \`package.json\` de esta carpeta.
2. La raíz del proyecto anfitrión (\`ctx.directory\`) debe contener \`fixtures/reto-01/\` (maestro, glosario, soportes y casos). Las salidas se escriben en \`out/\` de esa raíz.
3. Registra las herramientas en tu plataforma y llámalas con \`execute(args, { directory, sessionId })\`:

\`\`\`ts
import { herramientas } from "./tools/proveedor"

const ctx = { directory: process.cwd(), sessionId: "mi-sesion" }
const json = await herramientas.armar_paquete.execute({ caso: "ec-corp-andina" }, ctx)
// → '{"ok":true,"data":{...}}'  (nunca lanza; los errores llegan como {"ok":false,"error":...})
\`\`\`

## Diferencias con la aplicación (a propósito)

- **No hay servidor**, así que nadie impone la confirmación del envío por ti. La protección en el módulo es el prompt (regla 3 de \`agent.md\`) más el argumento \`confirmado\` de \`proveedor_simular_envio\`, que la plataforma anfitriona debe poner en \`true\` solo tras una confirmación humana explícita. En la aplicación, en cambio, el servidor lo exige y el modelo ni siquiera ve ese argumento.
- **Almacenamiento solo local** (\`out/\`). El backend de Supabase pertenece a la aplicación desplegada y no se incluye.
- La fecha de vigencia de los soportes se toma de \`ctx.fechaReferencia\`, de la variable \`FECHA_REFERENCIA\` o, por defecto, 2026-09-03.
`
}

async function packageJson(directory: string): Promise<string> {
  const raiz = JSON.parse(await leer(directory, "package.json")) as { dependencies: Record<string, string> }
  const deps = Object.fromEntries(["zod", "exceljs", "pdf-lib"].map((n) => [n, raiz.dependencies[n] as string]))
  return JSON.stringify({ name: "registro-proveedor-modulo", private: true, type: "module", description: AVISO, dependencies: deps }, null, 2) + "\n"
}

/** Contenido completo y esperado de modulo/, por ruta relativa. */
export async function generarModulo(directory: string): Promise<Record<string, string>> {
  return {
    "agent.md": agenteMd(await leer(directory, "agent/prompt.md")),
    "skill/registro-proveedor/SKILL.md": skillMd(await leer(directory, "src/knowledge/registro-proveedor.md")),
    "tools/proveedor.ts": await empaquetarHerramientas(directory),
    "package.json": await packageJson(directory),
    "README.md": readmeModulo(),
  }
}

/** Lo que hay hoy en modulo/, por ruta relativa. */
export async function leerModulo(directory: string): Promise<Record<string, string>> {
  const raiz = path.join(directory, "modulo")
  const salida: Record<string, string> = {}
  const recorrer = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const completa = path.join(dir, e.name)
      if (e.isDirectory()) await recorrer(completa)
      else salida[path.relative(raiz, completa).split(path.sep).join("/")] = await readFile(completa, "utf8")
    }
  }
  await recorrer(raiz)
  return salida
}

/** Rutas que faltan, sobran o difieren entre lo esperado y lo que hay en disco. */
export function diferencias(esperado: Record<string, string>, actual: Record<string, string>): string[] {
  const rutas = new Set([...Object.keys(esperado), ...Object.keys(actual)])
  const mal: string[] = []
  for (const r of [...rutas].sort()) {
    if (!(r in actual)) mal.push(`falta modulo/${r}`)
    else if (!(r in esperado)) mal.push(`sobra modulo/${r} (no lo genera el script)`)
    else if (esperado[r] !== actual[r]) mal.push(`modulo/${r} difiere de lo que generan las fuentes`)
  }
  return mal
}
