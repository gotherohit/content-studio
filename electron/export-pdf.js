const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A page the shape of the export: 16:9 is PowerPoint's widescreen slide, 9:16 the same turned upright. */
export const PAGE = { landscape: { width: 13.333, height: 7.5 }, vertical: { width: 7.5, height: 13.333 } };

/** One page per beat, each picture filling its page edge to edge. `pages` are file names beside the page. */
export function beatsPdfHtml(title, pages, shape) {
  const page = PAGE[shape] ?? PAGE.landscape;
  const images = pages.map((name) => `<img src="${escapeHtml(encodeURI(name))}" alt="">`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>`
    + `@page{size:${page.width}in ${page.height}in;margin:0}html,body{margin:0;padding:0;background:#000}`
    + `img{display:block;width:${page.width}in;height:${page.height}in;object-fit:contain;break-after:page}`
    + `img:last-child{break-after:auto}</style></head><body>${images}</body></html>`;
}
