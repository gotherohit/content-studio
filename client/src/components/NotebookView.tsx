import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface Cell {
  cell_type: string;
  source: string | string[];
  execution_count?: number | null;
  outputs?: Output[];
}
interface Output {
  output_type: string;
  text?: string | string[];
  name?: string;
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : s ?? "");

function OutputBlock({ out }: { out: Output }) {
  if (out.output_type === "stream") {
    return <pre className={`nb-out ${out.name === "stderr" ? "err" : ""}`}>{join(out.text)}</pre>;
  }
  if (out.output_type === "error") {
    const text = (out.traceback || []).join("\n").replace(/\[[0-9;]*m/g, "");
    return <pre className="nb-out err">{text || `${out.ename}: ${out.evalue}`}</pre>;
  }
  const data = out.data || {};
  if (data["image/png"]) return <img className="nb-img" src={`data:image/png;base64,${join(data["image/png"]).replace(/\s/g, "")}`} alt="output" />;
  if (data["image/jpeg"]) return <img className="nb-img" src={`data:image/jpeg;base64,${join(data["image/jpeg"]).replace(/\s/g, "")}`} alt="output" />;
  if (data["image/svg+xml"]) return <div className="nb-img" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(join(data["image/svg+xml"])) }} />;
  if (data["text/html"]) return <div className="nb-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(join(data["text/html"])) }} />;
  if (data["text/markdown"]) return <div className="md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(join(data["text/markdown"])) as string) }} />;
  if (data["text/plain"]) return <pre className="nb-out">{join(data["text/plain"])}</pre>;
  return null;
}

/** Renders a .ipynb: markdown cells, code cells and their outputs including images. */
export function NotebookView({ url }: { url: string }) {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCells(null); setErr(null);
    fetch(url)
      .then((r) => r.json())
      .then((nb) => { if (!cancelled) setCells(Array.isArray(nb.cells) ? nb.cells : []); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [url]);

  if (err) return <div className="panel-empty">Could not read this notebook: {err}</div>;
  if (!cells) return <div className="panel-empty">Loading notebook…</div>;

  return (
    <div className="notebook">
      {cells.map((cell, i) => {
        const src = join(cell.source);
        if (cell.cell_type === "markdown") {
          return <div key={i} className="nb-cell nb-md md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(src) as string) }} />;
        }
        if (cell.cell_type !== "code") return null;
        return (
          <div key={i} className="nb-cell">
            <div className="nb-code">
              <span className="nb-prompt">[{cell.execution_count ?? " "}]</span>
              <pre>{src}</pre>
            </div>
            {(cell.outputs || []).map((o, j) => <OutputBlock key={j} out={o} />)}
          </div>
        );
      })}
    </div>
  );
}
