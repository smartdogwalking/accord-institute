import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./errors";
import type { Matter, SourceBlock } from "./types";
import yauzl from "yauzl";
export const maxUpload = 15 * 1024 * 1024;
export function normalize(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t \u00a0]+/g, " ")
    .trim();
}
async function checkDocx(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(new AppError("This Word document could not be opened."));
      let total = 0,
        count = 0,
        main = false;
      zip.on("error", () =>
        reject(new AppError("This Word document could not be opened.")),
      );
      zip.on("entry", (e) => {
        total += e.uncompressedSize;
        count++;
        if (e.fileName === "word/document.xml") main = true;
        if (
          count > 3000 ||
          total > 50 * 1024 * 1024 ||
          e.uncompressedSize > 20 * 1024 * 1024 ||
          e.generalPurposeBitFlag & 1
        ) {
          zip.close();
          reject(
            new AppError(
              "This Word document exceeds the safe import limits or is encrypted.",
            ),
          );
          return;
        }
        zip.readEntry();
      });
      zip.on("end", () =>
        main
          ? resolve()
          : reject(new AppError("The file is not a valid .docx document.")),
      );
      zip.readEntry();
    }),
  );
}
export async function ingest(
  filename: string,
  buffer: Buffer,
): Promise<Matter> {
  if (!buffer.length || buffer.length > maxUpload)
    throw new AppError("Choose a non-empty PDF, DOCX or TXT file up to 15 MB.");
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "txt"].includes(extension || ""))
    throw new AppError("Supported formats are PDF, DOCX and UTF-8 TXT.");
  const blocks: SourceBlock[] = [],
    warnings: string[] = [];
  if (extension === "pdf") {
    if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new AppError("This file is not a readable PDF.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: Uint8Array.from(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 150)
        throw new AppError("PDFs are limited to 150 pages in this version.");
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page);
        const content = await p.getTextContent();
        const text = normalize(
          content.items
            .map((i) =>
              "str" in i
                ? i.str + ("hasEOL" in i && i.hasEOL ? "\n" : " ")
                : "",
            )
            .join(""),
        );
        blocks.push({
          id: `page-${page}`,
          locator: `PDF page ${page}`,
          page,
          text,
        });
        if (text.length < 30)
          warnings.push(
            `Page ${page} has very little readable text. It may require OCR.`,
          );
        p.cleanup();
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "This PDF could not be read. It may be encrypted, damaged or unsupported.",
      );
    } finally {
      await task.destroy();
    }
  } else {
    let text: string;
    if (extension === "docx") {
      await checkDocx(buffer);
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      if (result.messages.length)
        warnings.push(
          "The Word parser reported omitted or unsupported content. Compare the imported text with the original.",
        );
      warnings.push(
        "Word sources use paragraph locators; original page numbers are not available.",
      );
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        throw new AppError("Text files must use UTF-8 encoding.");
      }
      if (text.includes("\u0000"))
        throw new AppError("The text file contains binary data.");
      warnings.push(
        "Text sources use paragraph locators, not original page numbers.",
      );
    }
    for (const paragraph of text.split(/\n\s*\n/)) {
      const t = normalize(paragraph);
      if (t)
        blocks.push({
          id: `paragraph-${blocks.length + 1}`,
          locator: `Paragraph ${blocks.length + 1}`,
          text: t,
        });
    }
  }
  const count = blocks.reduce((n, b) => n + b.text.length, 0);
  if (count < 100)
    throw new AppError(
      "Too little readable text. Scanned documents need OCR before import; this app does not silently analyze an empty document.",
    );
  if (count > 400000 || blocks.length > 4000)
    throw new AppError(
      "The extracted document exceeds this version’s import limit. Use a smaller complete agreement.",
    );
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: filename.replace(/\.[^.]+$/, "").slice(0, 150),
    created_at: now,
    revision: 0,
    source: {
      filename: filename.replace(/[\r\n\/\\]/g, "_").slice(0, 200),
      format: extension as "pdf" | "docx" | "txt",
      hash: createHash("sha256").update(buffer).digest("hex"),
      original: buffer.toString("base64"),
      blocks,
      warnings,
    },
    runs: [],
    audit: [{ at: now, action: "Document imported" }],
  };
}
