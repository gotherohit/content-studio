import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface ResearchAttachment { name: string; kind: "text" | "pdf"; content: string; truncated: boolean }
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_CHARS = 60000;
export const MAX_TOTAL_CHARS = 90000;
const textExtensions = /\.(txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|sh|ps1|sql|svg|mermaid|mmd|log)$/i;

export async function readResearchAttachment(file: File): Promise<ResearchAttachment> {
  const name = file.name.slice(0, 180);
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > 10_000_000) throw new Error(`${name} exceeds the 10 MB PDF limit.`);
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/" });
    const document = await task.promise;
    try {
      let content = "";
      for (let page = 1; page <= Math.min(document.numPages, 20); page++) {
        const items = (await (await document.getPage(page)).getTextContent()).items;
        content += `\n[Page ${page}]\n` + items.map((item) => "str" in item ? item.str : "").join(" ") + "\n";
        if (content.length > MAX_ATTACHMENT_CHARS) break;
      }
      if (!content.trim()) throw new Error(`${name} has no selectable text. Scanned PDFs need OCR before attachment.`);
      return { name, kind: "pdf", content: content.slice(0, MAX_ATTACHMENT_CHARS), truncated: document.numPages > 20 || content.length > MAX_ATTACHMENT_CHARS };
    } finally { await task.destroy(); }
  }
  if (!textExtensions.test(name) && !file.type.startsWith("text/")) throw new Error(`${name} is not a supported text or PDF file.`);
  if (file.size > 2_000_000) throw new Error(`${name} exceeds the 2 MB text-file limit.`);
  const content = await file.text();
  if (content.includes("\0")) throw new Error(`${name} appears to be a binary file.`);
  return { name, kind: "text", content: content.slice(0, MAX_ATTACHMENT_CHARS), truncated: content.length > MAX_ATTACHMENT_CHARS };
}
