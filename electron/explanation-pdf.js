const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Keep model and article text inert while giving the exported conversation readable sections. */
export function explanationPdfHtml(markdown) {
  const blocks = markdown.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.length === 1 && lines[0].startsWith("# ")) return `<h1>${escapeHtml(lines[0].slice(2))}</h1>`;
    if (lines.length === 1 && lines[0].startsWith("## ")) return `<h2>${escapeHtml(lines[0].slice(3))}</h2>`;
    if (lines.every((line) => line.startsWith("> "))) return `<blockquote>${escapeHtml(lines.map((line) => line.slice(2)).join("\n"))}</blockquote>`;
    return `<p>${escapeHtml(block)}</p>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:11pt/1.55 'Segoe UI',sans-serif;color:#17232c}h1{font-size:18pt;line-height:1.25}h2{font-size:13pt;margin-top:22pt;border-bottom:1px solid #cbd7df;padding-bottom:4pt}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin:12pt 0;padding:8pt 12pt;border-left:3pt solid #14b8c8;background:#f1fbfc}p{margin:10pt 0}</style></head><body>${blocks}</body></html>`;
}
