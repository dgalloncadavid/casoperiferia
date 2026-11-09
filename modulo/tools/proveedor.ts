// @ts-nocheck
// GENERADO por scripts/build-modulo.ts desde las fuentes de la aplicación. No editar a mano: se pierde al regenerar y test/modulo.test.ts falla si se desalinea.
// src/tools/proveedor.ts
import { z as z2 } from "zod";

// src/storage/index.ts
import path2 from "node:path";

// src/storage/local.ts
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// src/storage/types.ts
function rutaSegura(path) {
  const limpia = path.replace(/\\/g, "/");
  const partes = limpia.split("/");
  if (limpia.startsWith("/") || partes.some((p) => p === ".." || p === "")) {
    throw new Error("ruta de almacenamiento inválida");
  }
  return limpia;
}
function idSesionSeguro(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new Error("id de sesión inválido");
  return id;
}

// src/storage/local.ts
class LocalStorage {
  root;
  kind = "local";
  constructor(root) {
    this.root = root;
  }
  abs(rel) {
    return path.join(this.root, rutaSegura(rel));
  }
  async writeFile(rel, data) {
    const destino = this.abs(rel);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, data);
  }
  async readFile(rel) {
    try {
      return new Uint8Array(await readFile(this.abs(rel)));
    } catch {
      return null;
    }
  }
  async exists(rel) {
    try {
      await stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }
  async list(prefix) {
    const base = this.abs(prefix);
    const salida = [];
    const recorrer = async (dir) => {
      const entradas = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entradas) {
        const completa = path.join(dir, e.name);
        if (e.isDirectory())
          await recorrer(completa);
        else
          salida.push(path.relative(this.root, completa).split(path.sep).join("/"));
      }
    };
    await recorrer(base);
    return salida.sort();
  }
  async appendLog(entry) {
    const linea = JSON.stringify(entry) + `
`;
    await mkdir(this.root, { recursive: true });
    await appendFile(path.join(this.root, "log.jsonl"), linea);
    if (entry.caso) {
      await mkdir(path.join(this.root, entry.caso), { recursive: true });
      await appendFile(path.join(this.root, entry.caso, "log.jsonl"), linea);
    }
  }
  async readLogs(caso) {
    const archivo = caso ? path.join(this.root, rutaSegura(caso), "log.jsonl") : path.join(this.root, "log.jsonl");
    try {
      const texto = await readFile(archivo, "utf8");
      return texto.split(`
`).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  async saveSession(id, data) {
    await this.writeFile(`sessions/${idSesionSeguro(id)}.json`, JSON.stringify(data));
  }
  async loadSession(id) {
    const bytes = await this.readFile(`sessions/${idSesionSeguro(id)}.json`);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  }
  golpes = new Map;
  async getUsage(dia) {
    const vacio = { tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, peticiones: 0 };
    const bytes = await this.readFile(`usage/${rutaSegura(dia)}.json`);
    return bytes ? { ...vacio, ...JSON.parse(new TextDecoder().decode(bytes)) } : vacio;
  }
  async addUsage(dia, uso) {
    const a = await this.getUsage(dia);
    const total = {
      tokensEntrada: a.tokensEntrada + uso.tokensEntrada,
      tokensSalida: a.tokensSalida + uso.tokensSalida,
      costoUsd: a.costoUsd + uso.costoUsd,
      peticiones: a.peticiones + uso.peticiones
    };
    await this.writeFile(`usage/${rutaSegura(dia)}.json`, JSON.stringify(total));
    return total;
  }
  async rateHit(clave, ventanaSeg) {
    const ahora = Date.now();
    const vivos = (this.golpes.get(clave) ?? []).filter((t) => ahora - t < ventanaSeg * 1000);
    vivos.push(ahora);
    this.golpes.set(clave, vivos);
    return vivos.length;
  }
  async clean() {
    const entradas = await readdir(this.root).catch(() => []);
    for (const e of entradas)
      if (e !== "usage")
        await rm(path.join(this.root, e), { recursive: true, force: true });
  }
}

// stub:supabase-no-incluido
class SupabaseStorage {
  constructor() {
    throw new Error("El módulo empaquetado solo incluye almacenamiento local (STORAGE=local). Supabase pertenece a la aplicación desplegada.");
  }
}

// src/storage/index.ts
var actual = null;
function crear(directory) {
  const modo = process.env.STORAGE ?? "local";
  if (modo === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error("STORAGE=supabase requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    return new SupabaseStorage(url, key, process.env.SUPABASE_BUCKET ?? "paquetes");
  }
  if (modo !== "local")
    throw new Error("STORAGE debe ser local o supabase");
  const raiz = process.env.OUT_DIR || (process.env.VERCEL ? "/tmp/out" : "out");
  return new LocalStorage(path2.resolve(directory, raiz));
}
function getStorage(directory) {
  if (!actual)
    actual = crear(directory);
  return actual;
}

// src/core/fixtures.ts
import { readFile as readFile2, readdir as readdir2, stat as stat2 } from "node:fs/promises";
import path3 from "node:path";
import { z } from "zod";

// src/core/types.ts
var ok = (data) => ({ ok: true, data });
var fail = (error, codigo, parcial) => ({
  ok: false,
  error,
  ...codigo ? { codigo } : {},
  ...parcial !== undefined ? { parcial } : {}
});

// src/core/fixtures.ts
var CASO_RE = /^[a-z0-9-]+$/;
var RAIZ_FIXTURES = "fixtures/reto-01";
var RAICES_PERMITIDAS = ["fixtures", "fixtures-test"];
var solicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  adjuntos: z.array(z.string())
});
var celdasSchema = z.array(z.object({
  hoja: z.string().min(1),
  celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/),
  etiqueta: z.string().min(1),
  celda_valor: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/)
}));
var camposSchema = z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() }));
var exigidosSchema = z.array(z.string());
var glosarioSchema = z.record(z.string(), z.string());
var maestroSchema = z.record(z.string(), z.unknown());
var indexSchema = z.array(z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string().optional()
}));
async function leerJson(archivo, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile2(archivo, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function dentroDe(base, destino) {
  return destino === base || destino.startsWith(base + path3.sep);
}
async function resolverCaso(caso, ctx) {
  if (!CASO_RE.test(caso) || caso.length > 64) {
    return fail("nombre de caso inválido: solo minúsculas, números y guiones", "caso_invalido");
  }
  const raiz = path3.resolve(ctx.directory, ctx.casosRoot ?? `${RAIZ_FIXTURES}/casos`);
  const permitido = RAICES_PERMITIDAS.some((r) => dentroDe(path3.resolve(ctx.directory, r), raiz));
  if (!permitido)
    return fail("la carpeta de casos debe estar dentro de fixtures/", "caso_invalido");
  const dir = path3.resolve(raiz, caso);
  if (!dentroDe(raiz, dir) || dir === raiz)
    return fail("ruta de caso fuera de fixtures/", "caso_invalido");
  const info = await stat2(dir).catch(() => null);
  if (!info?.isDirectory())
    return fail(`caso no encontrado: ${caso}`, "caso_no_encontrado");
  return ok(dir);
}
async function cargarCaso(caso, ctx) {
  const dir = await resolverCaso(caso, ctx);
  if (!dir.ok)
    return dir;
  const solicitud = await leerJson(path3.join(dir.data, "solicitud.json"), solicitudSchema);
  if (!solicitud)
    return fail("solicitud.json ausente o con formato inválido", "solicitud_invalida");
  const exigidos = await leerJson(path3.join(dir.data, "soportes-exigidos.json"), exigidosSchema);
  if (!exigidos)
    return fail("soportes-exigidos.json ausente o con formato inválido", "solicitud_invalida");
  const archivo = solicitud.formato === "xlsx" ? "plantilla-celdas.json" : "plantilla-campos.json";
  const schema = solicitud.formato === "xlsx" ? celdasSchema : camposSchema;
  const campos = await leerJson(path3.join(dir.data, archivo), schema);
  const plantilla = campos ? ok(campos) : fail(`plantilla corrupta o ausente (${archivo}): no se pueden leer los campos`, "plantilla_corrupta");
  return ok({ solicitud, exigidos, plantilla });
}
async function cargarRepositorio(ctx) {
  const base = path3.resolve(ctx.directory, RAIZ_FIXTURES);
  const maestro = await leerJson(path3.join(base, "repositorio/maestro.json"), maestroSchema);
  const glosario = await leerJson(path3.join(base, "glosario-campos.json"), glosarioSchema);
  const soportes = await leerJson(path3.join(base, "repositorio/soportes/index.json"), indexSchema);
  if (!maestro || !glosario || !soportes) {
    return fail("repositorio maestro, glosario o índice de soportes ilegible", "repositorio_ilegible");
  }
  return ok({ maestro, glosario, soportes, dirSoportes: path3.join(base, "repositorio/soportes") });
}

// src/core/envio.ts
async function simularEnvio(caso, confirmado, ctx) {
  if (confirmado !== true)
    return fail("requiere confirmación explícita", "requiere_confirmacion");
  const dir = await resolverCaso(caso, ctx);
  if (!dir.ok)
    return dir;
  const storage = getStorage(ctx.directory);
  const bytes = await storage.readFile(`${caso}/estado.json`);
  if (!bytes)
    return fail("el paquete aún no está armado: ejecute proveedor_armar_paquete primero", "paquete_no_armado");
  const estado = JSON.parse(new TextDecoder().decode(bytes));
  if (estado.estado_firma === "no_aplica") {
    return fail("formato portal: el alta la hace una persona en el portal; no hay envío que simular", "formato_no_soportado");
  }
  const rel = `${caso}/ENVIO-SIMULADO.md`;
  const ruta = `out/${rel}`;
  const incompleto = !estado.listo_para_firma;
  if (await storage.exists(rel))
    return ok({ ruta, incompleto, existente: true });
  const archivos = (await storage.list(`${caso}/paquete`)).map((a) => a.slice(caso.length + 1));
  const md = [
    "# ENVÍO SIMULADO",
    "",
    "> No se envió nada. Este archivo solo deja constancia de la confirmación del usuario.",
    "",
    `- **Caso:** ${caso}`,
    `- **Registrado:** ${new Date().toISOString()}`,
    `- **Fecha de referencia de los soportes:** ${estado.fecha_referencia}`,
    `- **Estado del paquete:** ${incompleto ? "INCOMPLETO" : "COMPLETO"}`,
    ...incompleto ? ["", "## Pendientes al momento del envío", ...estado.bloqueadores.map((b) => `- ${b}`)] : [],
    "",
    "## Contenido del paquete",
    ...archivos.map((a) => `- ${a}`),
    ""
  ].join(`
`);
  await storage.writeFile(rel, md);
  return ok({ ruta, incompleto, existente: false });
}

// src/core/formulario.ts
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// src/core/util.ts
var FECHA_REFERENCIA_DEFECTO = "2026-09-03";
function normalizar(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
function fechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f))
    return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(f);
}
function diasEntre(desde, hasta) {
  const ms = new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}
function resolverFecha(ctx) {
  const f = ctx.fechaReferencia ?? process.env.FECHA_REFERENCIA ?? FECHA_REFERENCIA_DEFECTO;
  return fechaValida(f) ? f : null;
}
function agrupar(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function linea(texto) {
  return texto.replace(/[\r\n]+/g, " ").trim();
}

// src/core/mapeo.ts
var IDENTIFICADOR_POR_PAIS = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" };
var PAISES = {
  CO: "Colombia",
  EC: "Ecuador",
  PE: "Perú",
  PA: "Panamá",
  HN: "Honduras"
};
var nombrePais = (codigo) => PAISES[codigo] ?? codigo;
var CONF_EXACTA = 1;
var CONF_NORMALIZADA = 0.9;
var CONF_REGLA = 0.7;
var UMBRAL_CONFIANZA = 0.8;
function obtener(maestro, ruta) {
  let actual = maestro;
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null)
      return;
    actual = actual[parte];
  }
  return actual;
}
function formatear(clave, valor, maestro) {
  if (clave === "pais" && typeof valor === "string")
    return PAISES[valor] ?? null;
  if (clave === "ingresos_ultimo_ano.valor" && typeof valor === "number") {
    const moneda = obtener(maestro, "ingresos_ultimo_ano.moneda");
    const ano = obtener(maestro, "ingresos_ultimo_ano.ano");
    return `${agrupar(valor)} ${String(moneda)} (${String(ano)})`;
  }
  if (typeof valor === "string" && valor.trim() !== "")
    return valor;
  if (typeof valor === "number")
    return String(valor);
  return null;
}
function buscarClave(etiqueta, glosario) {
  const exacta = glosario[etiqueta];
  if (exacta)
    return { clave: exacta, confianza: CONF_EXACTA };
  const objetivo = normalizar(etiqueta);
  for (const [k, v] of Object.entries(glosario)) {
    if (normalizar(k) === objetivo)
      return { clave: v, confianza: CONF_NORMALIZADA };
  }
  return null;
}
function mapearCampo(campo, glosario, maestro, pais) {
  const base = { etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, hoja: campo.hoja, celda_etiqueta: campo.celda_etiqueta, celda_valor: campo.celda_valor };
  const hallado = buscarClave(campo.etiqueta, glosario);
  if (!hallado) {
    return { ...base, estado: "faltante", confianza: 0, nota: "no existe en el glosario ni en el maestro" };
  }
  const { clave } = hallado;
  let { confianza } = hallado;
  const notas = [];
  if (clave === "digito_verificacion" && pais !== "CO") {
    return { ...base, estado: "faltante", confianza: 0, clave, nota: "el dígito de verificación solo aplica a Colombia" };
  }
  const valor = formatear(clave, obtener(maestro, clave), maestro);
  if (valor === null) {
    return { ...base, estado: "faltante", confianza: 0, clave, nota: "el maestro no tiene este dato" };
  }
  let razon;
  let regla;
  if (clave === "nit") {
    const local = IDENTIFICADOR_POR_PAIS[pais] ?? "identificador tributario";
    if (pais !== "CO") {
      confianza = Math.min(confianza, CONF_REGLA);
      notas.push(`identificador extranjero: se usa el NIT colombiano como ${local}`);
      razon = `Periferia solo tiene NIT colombiano y este cliente pide el ${local}. Se llenó con el NIT.`;
      regla = `Para clientes fuera de Colombia, el identificador tributario se llena con el NIT y siempre se confirma: el cliente puede aceptarlo o pedir un registro local.`;
    } else if (normalizar(campo.etiqueta) !== "nit") {
      confianza = Math.min(confianza, CONF_REGLA);
      notas.push("etiqueta de identificador ambigua: se propone el NIT");
      razon = `La etiqueta «${campo.etiqueta}» no dice qué identificador pide el cliente. Se propone el NIT.`;
      regla = "Cuando la etiqueta es ambigua se propone el identificador del país del cliente y se pide confirmación.";
    }
  }
  if (clave === "ingresos_ultimo_ano.valor") {
    confianza = Math.min(confianza, CONF_REGLA);
    notas.push("la cifra está en COP del maestro; confirmar moneda con el cliente");
    razon = "El maestro guarda los ingresos en pesos colombianos (COP) y la cifra no se convierte a otra moneda.";
    regla = "Los ingresos siempre se escriben con su moneda y su año, y se confirman antes de firmar.";
  }
  const estado = confianza < UMBRAL_CONFIANZA ? "requiere_confirmacion" : "lleno";
  return {
    ...base,
    estado,
    confianza,
    clave,
    ruta_maestro: clave,
    valor,
    ...notas.length ? { nota: notas.join("; ") } : {},
    ...razon ? { razon, regla } : {}
  };
}
function mapear(campos, glosario, maestro, pais) {
  return campos.map((c) => mapearCampo(c, glosario, maestro, pais));
}

// src/core/formulario.ts
async function mapearCaso(caso, ctx) {
  const cargado = await cargarCaso(caso, ctx);
  if (!cargado.ok)
    return cargado;
  if (!cargado.data.plantilla.ok)
    return cargado.data.plantilla;
  const repo = await cargarRepositorio(ctx);
  if (!repo.ok)
    return repo;
  const { solicitud, plantilla, exigidos } = cargado.data;
  const campos = mapear(plantilla.data, repo.data.glosario, repo.data.maestro, solicitud.pais);
  return ok({ solicitud, exigidos, campos, repo: repo.data });
}
function tieneCeldas(c) {
  return Boolean(c.hoja && c.celda_etiqueta && c.celda_valor);
}
async function generarXlsx(caso, campos, ctx) {
  const celdas = campos.filter(tieneCeldas);
  if (celdas.length !== campos.length)
    return fail("plantilla sin hoja o celda de valor", "plantilla_corrupta");
  const wb = new ExcelJS.Workbook;
  wb.creator = "Agente de registro de proveedor";
  for (const c of celdas) {
    const hoja = wb.getWorksheet(c.hoja) ?? wb.addWorksheet(c.hoja);
    for (const ref of [c.celda_etiqueta, c.celda_valor])
      hoja.getColumn(ref.replace(/[0-9]/g, "")).width = 42;
    const etiqueta = hoja.getCell(c.celda_etiqueta);
    etiqueta.value = c.etiqueta;
    etiqueta.font = { bold: true };
    const valor = hoja.getCell(c.celda_valor);
    valor.numFmt = "@";
    if (c.valor !== undefined)
      valor.value = c.valor;
  }
  const rel = `${caso}/formulario.xlsx`;
  await getStorage(ctx.directory).writeFile(rel, new Uint8Array(await wb.xlsx.writeBuffer()));
  const diferencias = await verificarXlsx(rel, celdas, ctx);
  if (diferencias.length > 0) {
    return fail(`la verificación del xlsx falló en ${diferencias.length} celda(s): ${diferencias.join(", ")}`, "verificacion_fallida");
  }
  return ok({ ruta: `out/${rel}`, rel, formato: "xlsx", soportado: true });
}
async function verificarXlsx(rel, celdas, ctx) {
  const bytes = await getStorage(ctx.directory).readFile(rel);
  if (!bytes)
    return ["archivo no encontrado"];
  const wb = new ExcelJS.Workbook;
  await wb.xlsx.load(Buffer.from(bytes));
  const malas = [];
  for (const c of celdas) {
    const hoja = wb.getWorksheet(c.hoja);
    const etiqueta = hoja?.getCell(c.celda_etiqueta);
    const valor = hoja?.getCell(c.celda_valor);
    const esperado = c.valor ?? "";
    const leido = valor?.value === null || valor?.value === undefined ? "" : String(valor.value);
    const tipoOk = esperado === "" || valor?.type === ExcelJS.ValueType.String;
    if (String(etiqueta?.value ?? "") !== c.etiqueta)
      malas.push(`${c.hoja}!${c.celda_etiqueta}`);
    if (leido !== esperado || !tipoOk)
      malas.push(`${c.hoja}!${c.celda_valor}`);
  }
  return malas;
}
function textoPdf(fuente, texto) {
  let salida = "";
  for (const ch of linea(texto)) {
    try {
      fuente.encodeText(ch);
      salida += ch;
    } catch {
      salida += "?";
    }
  }
  return salida;
}
function partir(fuente, texto, tamano, ancho) {
  const lineas = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(prueba, tamano) > ancho && actual) {
      lineas.push(actual);
      actual = palabra;
    } else
      actual = prueba;
  }
  lineas.push(actual);
  return lineas;
}
async function generarPdf(caso, cliente, campos, ctx) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Formulario de registro de proveedor");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [ancho, alto, margen] = [595, 842, 50];
  let pagina = pdf.addPage([ancho, alto]);
  let y = alto - margen;
  const nueva = (necesario) => {
    if (y - necesario < margen) {
      pagina = pdf.addPage([ancho, alto]);
      y = alto - margen;
    }
  };
  const escribir = (t, fuente, tam, gris = 0) => {
    nueva(tam + 4);
    pagina.drawText(textoPdf(fuente, t), { x: margen, y, size: tam, font: fuente, color: rgb(gris, gris, gris) });
    y -= tam + 4;
  };
  escribir("Formulario de registro de proveedor", negrita, 16);
  escribir(`Cliente: ${cliente}`, normal, 10, 0.3);
  y -= 10;
  for (const c of campos) {
    escribir(c.etiqueta, negrita, 9, 0.3);
    const lineas = partir(normal, textoPdf(normal, c.valor ?? ""), 11, ancho - 2 * margen);
    for (const l of lineas)
      escribir(l || " ", normal, 11);
    pagina.drawLine({ start: { x: margen, y: y + 2 }, end: { x: ancho - margen, y: y + 2 }, thickness: 0.4, color: rgb(0.75, 0.75, 0.75) });
    y -= 8;
  }
  y -= 20;
  nueva(60);
  y -= 40;
  pagina.drawLine({ start: { x: margen, y }, end: { x: margen + 220, y }, thickness: 0.8 });
  escribir("Firma del representante legal", normal, 9, 0.3);
  const rel = `${caso}/formulario.pdf`;
  await getStorage(ctx.directory).writeFile(rel, await pdf.save());
  return ok({ ruta: `out/${rel}`, rel, formato: "pdf", soportado: true });
}
async function generarPortal(caso, cliente, campos, ctx) {
  const filas = campos.map((c, i) => {
    const valor = c.valor !== undefined ? `\`${c.valor}\`` : "**FALTANTE**: completar a mano";
    const marca = c.estado === "requiere_confirmacion" ? ` ⚠ confirmar${c.nota ? ` (${c.nota})` : ""}` : "";
    return `${i + 1}. **${c.etiqueta}**: ${valor}${marca}`;
  });
  const md = [
    `# Valores para el portal de ${linea(cliente)}`,
    "",
    "> Copia cada valor en el formulario en línea, en este orden. El ingreso de credenciales y el clic en «Enviar» los hace una persona.",
    "",
    ...filas,
    ""
  ].join(`
`);
  const rel = `${caso}/valores-portal.md`;
  await getStorage(ctx.directory).writeFile(rel, md);
  return ok({ ruta: `out/${rel}`, rel, formato: "portal", soportado: false });
}
async function generarFormulario(caso, ctx) {
  const m = await mapearCaso(caso, ctx);
  if (!m.ok)
    return m;
  const { solicitud, campos } = m.data;
  if (solicitud.formato === "xlsx")
    return generarXlsx(caso, campos, ctx);
  if (solicitud.formato === "pdf")
    return generarPdf(caso, solicitud.cliente, campos, ctx);
  return generarPortal(caso, solicitud.cliente, campos, ctx);
}

// src/core/paquete.ts
import { readFile as readFile3 } from "node:fs/promises";
import path5 from "node:path";

// src/core/soportes.ts
import { access } from "node:fs/promises";
import path4 from "node:path";
var NOMBRES_SOPORTE = {
  camara_comercio: "Cámara de Comercio",
  rut: "RUT",
  certificacion_bancaria: "certificación bancaria",
  parafiscales: "certificado de aportes parafiscales",
  estados_financieros: "estados financieros",
  certificado_iso_9001: "certificado ISO 9001",
  certificado_cumplimiento_tributario: "certificado de cumplimiento tributario"
};
function nombreSoporte(tipo) {
  return NOMBRES_SOPORTE[tipo] ?? tipo.replace(/_/g, " ");
}
var UMBRAL_AMARILLA = 30;
var UMBRAL_ROJA = 15;
function alertaPorDias(dias) {
  if (dias === null)
    return "verde";
  if (dias < UMBRAL_ROJA)
    return "roja";
  if (dias < UMBRAL_AMARILLA)
    return "amarilla";
  return "verde";
}
async function existe(ruta) {
  return access(ruta).then(() => true, () => false);
}
async function evaluarSoportes(exigidos, indice, dirSoportes, paisCaso, fecha) {
  const resultado = [];
  for (const tipo of exigidos) {
    const entrada = indice.find((s) => s.tipo === tipo);
    const archivoValido = entrada && path4.basename(entrada.archivo) === entrada.archivo;
    if (!entrada || !archivoValido || !await existe(path4.join(dirSoportes, entrada.archivo))) {
      resultado.push({ tipo, estado: "ausente", alerta: "roja", vigencia_hasta: null, dias_restantes: null });
      continue;
    }
    const dias = entrada.vigencia_hasta === null ? null : diasEntre(fecha, entrada.vigencia_hasta);
    const vencido = dias !== null && dias < 0;
    resultado.push({
      tipo,
      archivo: entrada.archivo,
      estado: vencido ? "vencido" : "vigente",
      alerta: vencido ? "roja" : alertaPorDias(dias),
      vigencia_hasta: entrada.vigencia_hasta,
      dias_restantes: dias,
      pais_emisor: entrada.pais_emisor,
      ...entrada.pais_emisor !== paisCaso ? { advertencia: `emitido en ${nombrePais(entrada.pais_emisor)}; el cliente es de ${nombrePais(paisCaso)}` } : {}
    });
  }
  return resultado;
}
function describirSoporte(s) {
  const nombre = nombreSoporte(s.tipo);
  if (s.estado === "ausente")
    return `${nombre}: no está en el repositorio`;
  if (s.estado === "vencido")
    return `${nombre}: venció el ${s.vigencia_hasta}`;
  if (s.dias_restantes !== null && s.alerta !== "verde") {
    return `${nombre}: vence el ${s.vigencia_hasta} (quedan ${s.dias_restantes} días)`;
  }
  return `${nombre}: vigente`;
}

// src/core/paquete.ts
var ICONO = { verde: "\uD83D\uDFE2", amarilla: "\uD83D\uDFE1", roja: "\uD83D\uDD34" };
function construirChecklist(c) {
  const filas = c.soportes.map((s) => {
    const vig = s.vigencia_hasta ?? "sin vencimiento";
    const dias = s.dias_restantes === null ? "-" : String(s.dias_restantes);
    return `| ${nombreSoporte(s.tipo)} | ${s.estado} | ${vig} | ${dias} | ${ICONO[s.alerta]} ${s.alerta} | ${s.advertencia ?? ""} |`;
  });
  const lista = (xs, vacio) => xs.length ? xs.map((x) => `- ${x}`) : [`- ${vacio}`];
  return [
    "# Checklist del paquete para firma",
    "",
    `- **Fecha de referencia:** ${c.fecha_referencia}`,
    `- **Estado:** ${{ listo: "LISTO PARA FIRMA", bloqueado: "BLOQUEADO (no está listo para firma)", no_aplica: "NO APLICA (portal: lo hace una persona)" }[c.estado_firma]}`,
    "",
    "## Bloqueadores",
    ...lista(c.bloqueadores, "ninguno"),
    "",
    "## Soportes",
    "| Soporte | Estado | Vigencia hasta | Días | Alerta | Advertencia |",
    "|---|---|---|---|---|---|",
    ...filas,
    "",
    "## Campos por confirmar",
    ...lista(c.campos_por_confirmar, "ninguno"),
    "",
    "## Campos faltantes (no bloquean la firma)",
    ...lista(c.campos_faltantes, "ninguno"),
    ""
  ].join(`
`);
}
function construirCorreo(razonSocial, solicitud, adjuntos, bloqueadores) {
  const aviso = bloqueadores.length ? [`> ⚠ NOTA INTERNA (borrar antes de enviar): el paquete NO está listo para firma.`, ...bloqueadores.map((b) => `> - ${b}`), ""] : [];
  return [
    "> Borrador generado por el agente. No se ha enviado. Requiere revisión y firma del representante legal.",
    ...aviso,
    `**Para:** ${linea(solicitud.de)}`,
    `**Asunto:** Re: ${linea(solicitud.asunto)}`,
    "",
    "Buenos días,",
    "",
    `Adjuntamos el formulario diligenciado y los soportes solicitados para el registro de ${razonSocial} como proveedor de ${linea(solicitud.cliente)}.`,
    "",
    "**Adjuntos:**",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier observación.",
    "",
    "Cordialmente,",
    `Área administrativa — ${razonSocial}`,
    ""
  ].join(`
`);
}
async function armarPaquete(caso, ctx) {
  const cargado = await cargarCaso(caso, ctx);
  if (!cargado.ok)
    return cargado;
  const fecha = resolverFecha(ctx);
  if (!fecha)
    return fail("FECHA_REFERENCIA inválida: use AAAA-MM-DD", "fecha_invalida");
  const repo = await cargarRepositorio(ctx);
  if (!repo.ok)
    return repo;
  const { solicitud, exigidos, plantilla } = cargado.data;
  const storage = getStorage(ctx.directory);
  const bloqueadores = [];
  const soportes = await evaluarSoportes(exigidos, repo.data.soportes, repo.data.dirSoportes, solicitud.pais, fecha);
  for (const s of soportes) {
    if (s.estado === "ausente")
      bloqueadores.push(`Falta el soporte «${nombreSoporte(s.tipo)}»`);
    if (s.estado === "vencido")
      bloqueadores.push(`Soporte vencido: ${describirSoporte(s)}`);
  }
  let campos = [];
  if (plantilla.ok) {
    campos = mapear(plantilla.data, repo.data.glosario, repo.data.maestro, solicitud.pais);
  } else {
    bloqueadores.push(`Plantilla ilegible: ${plantilla.error}`);
  }
  const adjuntos = [];
  const form = plantilla.ok ? await generarFormulario(caso, ctx) : null;
  if (form?.ok) {
    const bytes = await storage.readFile(form.data.rel);
    const nombre = form.data.rel.split("/").pop();
    if (bytes) {
      await storage.writeFile(`${caso}/paquete/${nombre}`, bytes);
      adjuntos.push(nombre);
    }
  } else if (form) {
    bloqueadores.push(`Formulario no generado: ${form.error}`);
  }
  for (const s of soportes) {
    if (!s.archivo)
      continue;
    const bytes = new Uint8Array(await readFile3(path5.join(repo.data.dirSoportes, s.archivo)));
    await storage.writeFile(`${caso}/paquete/soportes/${s.archivo}`, bytes);
    adjuntos.push(`soportes/${s.archivo}`);
  }
  const esPortal = solicitud.formato === "portal";
  const estado = esPortal ? "no_aplica" : bloqueadores.length === 0 ? "listo" : "bloqueado";
  const checklist = {
    fecha_referencia: fecha,
    estado_firma: estado,
    bloqueadores,
    alertas: soportes.filter((s) => s.estado === "vigente" && s.alerta !== "verde").map((s) => `${describirSoporte(s)} (alerta ${s.alerta})`),
    advertencias: soportes.filter((s) => s.advertencia).map((s) => `${nombreSoporte(s.tipo)}: ${s.advertencia}`),
    soportes,
    campos_por_confirmar: campos.filter((c) => c.estado === "requiere_confirmacion").map((c) => c.etiqueta),
    campos_faltantes: campos.filter((c) => c.estado === "faltante").map((c) => c.etiqueta)
  };
  const razon = typeof repo.data.maestro.razon_social === "string" ? repo.data.maestro.razon_social : "Periferia IT Group S.A.S.";
  await storage.writeFile(`${caso}/paquete/checklist.md`, construirChecklist(checklist));
  await storage.writeFile(`${caso}/paquete/borrador-correo.md`, construirCorreo(razon, solicitud, adjuntos, estado === "no_aplica" ? [] : bloqueadores));
  const estadoCaso = { listo_para_firma: estado === "listo", estado_firma: estado, bloqueadores, fecha_referencia: fecha };
  await storage.writeFile(`${caso}/estado.json`, JSON.stringify(estadoCaso, null, 2));
  return ok({ ruta: `out/${caso}/paquete/`, listo_para_firma: estado === "listo", estado_firma: estado, checklist });
}

// src/tools/proveedor.ts
var FRASE_CASO = "Nombre de la carpeta del caso en fixtures/reto-01/casos/ (minúsculas, números y guiones)";
var ETIQUETAS_AMBIGUAS = new Set(["identificacion tributaria", "numero de identificacion fiscal"]);
function herramienta(nombre, def) {
  const schema = z2.object(def.args);
  return {
    description: def.description,
    args: def.args,
    ocultarAlModelo: def.ocultarAlModelo ?? [],
    async execute(args, ctx) {
      const parsed = schema.safeParse(args);
      let res;
      if (!parsed.success) {
        const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
        res = fail(`argumentos inválidos: ${detalle}`, "argumentos_invalidos");
      } else {
        try {
          res = await def.run(parsed.data, ctx);
        } catch {
          res = fail(`error interno al ejecutar ${nombre}`, "error_interno");
        }
      }
      const candidato = args?.caso;
      const caso = typeof candidato === "string" && CASO_RE.test(candidato) ? candidato : null;
      try {
        await getStorage(ctx.directory).appendLog({
          ts: new Date().toISOString(),
          herramienta: nombre,
          ok: res.ok,
          resumen: res.ok ? def.resumen(res.data) : `${res.codigo ?? "error"}: ${res.error}`.slice(0, 300),
          caso,
          sessionId: ctx.sessionId
        });
      } catch {}
      return JSON.stringify(res);
    }
  };
}
var leer_solicitud = herramienta("proveedor_leer_solicitud", {
  description: "Lee la solicitud del cliente y su plantilla: devuelve país, cliente, formato, campos pedidos y soportes exigidos.",
  args: { caso: z2.string().describe(FRASE_CASO) },
  async run({ caso }, ctx) {
    const c = await cargarCaso(caso, ctx);
    if (!c.ok)
      return c;
    const { solicitud, exigidos, plantilla } = c.data;
    if (!plantilla.ok)
      return plantilla;
    const local = IDENTIFICADOR_POR_PAIS[solicitud.pais] ?? "identificador tributario";
    return {
      ok: true,
      data: {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        identificador_tributario: local,
        campos: plantilla.data.map((p) => {
          const ambiguo = ETIQUETAS_AMBIGUAS.has(p.etiqueta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
          return {
            etiqueta: p.etiqueta,
            ...p.obligatorio !== undefined ? { obligatorio: p.obligatorio } : {},
            ...p.hoja ? { hoja: p.hoja, celda_valor: p.celda_valor } : {},
            ...ambiguo ? { requiere_confirmacion: true, equivalente_propuesto: local } : {}
          };
        }),
        soportes: exigidos,
        cuerpo_cliente_no_confiable: solicitud.cuerpo.slice(0, 2000)
      }
    };
  },
  resumen: (d) => `formato ${d.formato}, ${d.campos.length} campos, ${d.soportes.length} soportes exigidos`
});
var mapear_campos = herramienta("proveedor_mapear_campos", {
  description: "Cruza los campos de la plantilla del caso con el repositorio maestro y los clasifica en llenos, faltantes y por confirmar.",
  ocultarAlModelo: ["campos"],
  args: {
    caso: z2.string().describe(FRASE_CASO),
    campos: z2.array(z2.union([z2.string(), z2.object({ etiqueta: z2.string() })])).optional().describe("Ignorado: los campos siempre se toman de la plantilla del caso.")
  },
  async run({ caso }, ctx) {
    const m = await mapearCaso(caso, ctx);
    if (!m.ok)
      return m;
    const { campos } = m.data;
    return {
      ok: true,
      data: {
        llenos: campos.filter((c) => c.estado === "lleno"),
        faltantes: campos.filter((c) => c.estado === "faltante"),
        requiere_confirmacion: campos.filter((c) => c.estado === "requiere_confirmacion"),
        conteo: {
          total: campos.length,
          llenos: campos.filter((c) => c.estado === "lleno").length,
          por_confirmar: campos.filter((c) => c.estado === "requiere_confirmacion").length,
          faltantes: campos.filter((c) => c.estado === "faltante").length
        }
      }
    };
  },
  resumen: (d) => `${d.llenos.length + d.faltantes.length + d.requiere_confirmacion.length} campos: ${d.llenos.length} llenos, ${d.requiere_confirmacion.length} por confirmar, ${d.faltantes.length} faltantes`
});
var generar_formulario = herramienta("proveedor_generar_formulario", {
  description: "Genera el formulario del caso en el formato pedido (xlsx, pdf) o los valores copiables si es portal.",
  ocultarAlModelo: ["mapeo"],
  args: {
    caso: z2.string().describe(FRASE_CASO),
    mapeo: z2.unknown().optional().describe("Ignorado: el mapeo siempre se recalcula en el servidor desde el maestro.")
  },
  async run({ caso }, ctx) {
    const f = await generarFormulario(caso, ctx);
    if (!f.ok)
      return f;
    if (!f.data.soportado) {
      return fail("formato no soportado: el portal web no se automatiza; se generó valores-portal.md para copiar", "formato_no_soportado", {
        ruta: f.data.ruta,
        formato: f.data.formato
      });
    }
    return { ok: true, data: { ruta: f.data.ruta, formato: f.data.formato } };
  },
  resumen: (d) => `formulario ${d.formato} en ${d.ruta}`
});
var armar_paquete = herramienta("proveedor_armar_paquete", {
  description: "Arma el paquete para firma: formulario, soportes, checklist y borrador de correo; indica si está listo para firma.",
  args: { caso: z2.string().describe(FRASE_CASO) },
  run: ({ caso }, ctx) => armarPaquete(caso, ctx),
  resumen: (d) => `paquete ${d.estado_firma}, ${d.checklist.bloqueadores.length} bloqueadores, ${d.checklist.campos_faltantes.length} faltantes`
});
var simular_envio = herramienta("proveedor_simular_envio", {
  description: "Simula el envío escribiendo ENVIO-SIMULADO.md; exige confirmación explícita del usuario.",
  ocultarAlModelo: ["confirmado"],
  args: {
    caso: z2.string().describe(FRASE_CASO),
    confirmado: z2.boolean().describe("true solo si el usuario confirmó explícitamente en su mensaje inmediatamente anterior.")
  },
  run: ({ caso, confirmado }, ctx) => simularEnvio(caso, confirmado, ctx),
  resumen: (d) => `envío simulado ${d.incompleto ? "INCOMPLETO" : "completo"}${d.existente ? " (ya existía)" : ""} en ${d.ruta}`
});
var herramientas = { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, simular_envio };
export {
  armar_paquete,
  generar_formulario,
  herramientas,
  leer_solicitud,
  mapear_campos,
  simular_envio
};
