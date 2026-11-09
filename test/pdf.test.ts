import { expect, test } from "bun:test"
import path from "node:path"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { generarFormulario, mapearCaso } from "../src/core/formulario"
import { LocalStorage, setStorage } from "../src/storage"

const directory = path.resolve(import.meta.dirname, "..")

async function textoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise
  const lineas: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const contenido = await (await doc.getPage(p)).getTextContent()
    for (const it of contenido.items) if ("str" in it && it.str.trim() !== "") lineas.push(it.str.trim())
  }
  return lineas
}

test("HU-3 P1: el PDF reproduce todos los campos con etiqueta y valor, en el orden de la plantilla", async () => {
  const storage = new LocalStorage(path.join(directory, "out", `test-pdf-${process.pid}`))
  setStorage(storage)
  const ctx = { directory, sessionId: "pdf", fechaReferencia: "2026-09-03" }
  const gen = await generarFormulario("ec-corp-andina", ctx)
  expect(gen.ok).toBe(true)
  const bytes = await storage.readFile("ec-corp-andina/formulario.pdf")
  expect(bytes).not.toBeNull()
  const texto = await textoPdf(bytes as Uint8Array)
  const m = await mapearCaso("ec-corp-andina", ctx)
  if (!m.ok) throw new Error("no se pudo mapear")
  let cursor = 0
  for (const c of m.data.campos) {
    const iEtiqueta = texto.indexOf(c.etiqueta, cursor)
    expect(iEtiqueta, `falta la etiqueta «${c.etiqueta}» o está fuera de orden`).toBeGreaterThanOrEqual(cursor)
    cursor = iEtiqueta + 1
    if (c.valor !== undefined) {
      // Los valores largos se parten en líneas: se compara contra el texto contiguo que sigue a la etiqueta.
      const siguiente = texto.slice(iEtiqueta + 1, iEtiqueta + 4).join(" ")
      expect(siguiente, `falta el valor de «${c.etiqueta}»`).toContain(c.valor.split(" ")[0] as string)
    }
  }
  expect(texto).toContain("Firma del representante legal")
  await storage.clean()
})
