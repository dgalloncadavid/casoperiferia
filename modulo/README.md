# Módulo reutilizable: agente de registro como proveedor

> GENERADO por scripts/build-modulo.ts desde las fuentes de la aplicación. No editar a mano: se pierde al regenerar y test/modulo.test.ts falla si se desalinea.

Tres piezas, las mismas que usa la aplicación, para integrar el agente en otras plataformas de agentes **sin depender del servidor**:

| Pieza | Para qué |
|---|---|
| [agent.md](agent.md) | Definición del agente (frontmatter con `mode: primary` y permisos `edit: deny`, `bash: deny`). El cuerpo es el system prompt. |
| [skill/registro-proveedor/SKILL.md](skill/registro-proveedor/SKILL.md) | El conocimiento del proceso (qué pide cada país, vigencias, reglas). |
| [tools/proveedor.ts](tools/proveedor.ts) | Las 5 herramientas `proveedor_*` en un solo archivo. Cada export `<x>` se expone como `proveedor_<x>`. |

## Uso

1. Instala las dependencias: `bun install` (o `npm install`) con el `package.json` de esta carpeta.
2. La raíz del proyecto anfitrión (`ctx.directory`) debe contener `fixtures/reto-01/` (maestro, glosario, soportes y casos). Las salidas se escriben en `out/` de esa raíz.
3. Registra las herramientas en tu plataforma y llámalas con `execute(args, { directory, sessionId })`:

```ts
import { herramientas } from "./tools/proveedor"

const ctx = { directory: process.cwd(), sessionId: "mi-sesion" }
const json = await herramientas.armar_paquete.execute({ caso: "ec-corp-andina" }, ctx)
// → '{"ok":true,"data":{...}}'  (nunca lanza; los errores llegan como {"ok":false,"error":...})
```

## Diferencias con la aplicación (a propósito)

- **No hay servidor**, así que nadie impone la confirmación del envío por ti. La protección en el módulo es el prompt (regla 3 de `agent.md`) más el argumento `confirmado` de `proveedor_simular_envio`, que la plataforma anfitriona debe poner en `true` solo tras una confirmación humana explícita. En la aplicación, en cambio, el servidor lo exige y el modelo ni siquiera ve ese argumento.
- **Almacenamiento solo local** (`out/`). El backend de Supabase pertenece a la aplicación desplegada y no se incluye.
- La fecha de vigencia de los soportes se toma de `ctx.fechaReferencia`, de la variable `FECHA_REFERENCIA` o, por defecto, 2026-09-03.
