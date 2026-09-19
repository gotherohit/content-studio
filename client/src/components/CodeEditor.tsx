import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorSelection, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap, type DecorationSet } from "@codemirror/view";
import { LanguageDescription, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

/** Highlighted lines, 1-based and inclusive. `stale` when the code they quoted was rewritten. */
export interface LineMark { id: string; from: number; to: number; color: string; stale?: boolean }
export interface CodePlace { line: number; sel?: [number, number] }

interface Props {
  /** The text shown. It is only put into the editor when `docKey` changes, so typing is never undone. */
  doc: string;
  docKey: string;
  fileName: string;
  readOnly: boolean;
  dark: boolean;
  fontScale: number;
  marks: LineMark[];
  /** Dim every line outside these. */
  focus: [number, number] | null;
  /** Scroll and select here whenever `nonce` changes, and when a new document loads. */
  restore?: CodePlace & { nonce: number };
  /** Called on every edit, without the text: copying a large file per keystroke is too slow. */
  onChange?: () => void;
  /** Read the current text when it is needed — to save, or to find highlights again. */
  handle?: { current: { getDoc: () => string } | null };
  /** Skip syntax colours, for files too large to parse comfortably. */
  plain?: boolean;
  onSave?: () => void;
  onPlace?: (place: CodePlace) => void;
  onMarkClick?: (id: string) => void;
}

const setMarks = StateEffect.define<{ marks: LineMark[]; focus: [number, number] | null }>();

const marksField = StateField.define<{ marks: LineMark[]; focus: [number, number] | null; deco: DecorationSet }>({
  create: () => ({ marks: [], focus: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return { ...e.value, deco: build(tr.state, e.value.marks, e.value.focus) };
    return tr.docChanged ? { ...value, deco: value.deco.map(tr.changes) } : value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function build(state: EditorState, marks: LineMark[], focus: [number, number] | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= state.doc.lines; n++) {
    const classes: string[] = [];
    const mark = marks.find((m) => n >= m.from && n <= m.to);
    if (mark) classes.push("cm-code-mark", `cm-code-mark-${mark.color}`);
    if (focus && (n < focus[0] || n > focus[1])) classes.push("cm-code-dim");
    if (classes.length) builder.add(state.doc.line(n).from, state.doc.line(n).from, Decoration.line({ class: classes.join(" ") }));
  }
  return builder.finish();
}

class Bar extends GutterMarker {
  readonly color: string;
  readonly stale: boolean;
  constructor(color: string, stale: boolean) { super(); this.color = color; this.stale = stale; }
  eq(other: Bar) { return other.color === this.color && other.stale === this.stale; }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-mark-bar cm-mark-bar-${this.color}${this.stale ? " stale" : ""}`;
    el.title = this.stale ? "The code this highlight quoted has changed — click to see it" : "Click to see this highlight and its links";
    return el;
  }
}

const markAt = (view: EditorView, pos: number) => {
  const n = view.state.doc.lineAt(pos).number;
  return view.state.field(marksField).marks.find((m) => n >= m.from && n <= m.to);
};

/** A thin wrapper over CodeMirror: the pane owns files and saving, this owns the editor. */
export function CodeEditor(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const language = useRef(new Compartment());
  const settings = useRef(new Compartment());

  const settingsFor = (readOnly: boolean, dark: boolean, fontScale: number) => [
    EditorState.readOnly.of(readOnly),
    // basicSetup already falls back to the light style; the dark one must take precedence.
    dark ? syntaxHighlighting(oneDarkHighlightStyle) : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.theme({ "&": { fontSize: `${Math.round(13.5 * fontScale)}px` } }, { dark }),
  ];

  const extensions = () => [
    basicSetup,
    Prec.highest(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { latest.current.onSave?.(); return true; } }])),
    language.current.of([]),
    settings.current.of(settingsFor(latest.current.readOnly, latest.current.dark, latest.current.fontScale)),
    marksField,
    gutter({
      class: "cm-mark-gutter",
      lineMarker: (v, line) => { const m = markAt(v, line.from); return m ? new Bar(m.color, Boolean(m.stale)) : null; },
      lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setMarks))),
      domEventHandlers: {
        mousedown: (v, line) => { const m = markAt(v, line.from); if (m) { latest.current.onMarkClick?.(m.id); return true; } return false; },
      },
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) latest.current.onChange?.();
      if (u.docChanged || u.selectionSet) report();
    }),
  ];

  function report() {
    const v = view.current;
    if (!v) return;
    const top = v.scrollDOM.getBoundingClientRect().top - v.documentTop;
    const line = v.state.doc.lineAt(v.lineBlockAtHeight(Math.max(0, top)).from).number;
    const { from, to } = v.state.selection.main;
    let sel: [number, number] | undefined;
    if (from !== to) {
      const a = v.state.doc.lineAt(from).number;
      let b = v.state.doc.lineAt(to).number;
      if (b > a && v.state.doc.lineAt(to).from === to) b--;
      sel = [a, b];
    }
    latest.current.onPlace?.({ line, sel });
  }

  function place(target: CodePlace) {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const clamp = (n: number) => Math.min(Math.max(1, n), doc.lines);
    const selection = target.sel ? EditorSelection.range(doc.line(clamp(target.sel[0])).from, doc.line(clamp(target.sel[1])).to) : undefined;
    v.dispatch({ selection, effects: EditorView.scrollIntoView(doc.line(clamp(target.line)).from, { y: "start" }) });
  }

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: p.doc, extensions: extensions() }) });
    view.current = v;
    if (p.handle) p.handle.current = { getDoc: () => view.current?.state.doc.toString() ?? "" };
    let frame = 0;
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(report); };
    v.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => { cancelAnimationFrame(frame); v.scrollDOM.removeEventListener("scroll", scroll); v.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A new file, or the same file reloaded from disk: a fresh state, then its language.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.setState(EditorState.create({ doc: p.doc, extensions: extensions() }));
    v.dispatch({ effects: setMarks.of({ marks: latest.current.marks, focus: latest.current.focus }) });
    if (latest.current.restore) place(latest.current.restore);
    let cancelled = false;
    const description = latest.current.plain ? null : LanguageDescription.matchFilename(languages, p.fileName);
    description?.load().then((support) => {
      if (!cancelled && view.current === v) v.dispatch({ effects: language.current.reconfigure(support) });
    }).catch(() => { /* plain text is still readable */ });
    return () => { cancelled = true; };
  }, [p.docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    view.current?.dispatch({ effects: settings.current.reconfigure(settingsFor(p.readOnly, p.dark, p.fontScale)) });
  }, [p.readOnly, p.dark, p.fontScale]); // eslint-disable-line react-hooks/exhaustive-deps

  const marksKey = JSON.stringify([p.marks, p.focus]);
  useEffect(() => { view.current?.dispatch({ effects: setMarks.of({ marks: p.marks, focus: p.focus }) }); }, [marksKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.restore) place(p.restore); }, [p.restore?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="code-editor" ref={host} />;
}
