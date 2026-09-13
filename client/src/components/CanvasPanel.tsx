import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { CanvasView, Project } from "../types";

/** Only the part of Excalidraw's API this pane uses, so a version bump cannot break the import. */
type CanvasApi = {
  updateScene: (scene: { appState?: Record<string, unknown>; elements?: unknown[] }) => void;
  addFiles: (files: unknown[]) => void;
};

function sceneVersion(elements: readonly unknown[], files?: Record<string, unknown>) {
  return elements.map((element) => {
    const el = element as { id: string; version: number; versionNonce: number };
    return `${el.id}:${el.version}:${el.versionNonce}`;
  }).join("|") + Object.keys(files ?? {}).join("|");
}

interface Props {
  canvas: Project["canvas"];
  onChange: (c: NonNullable<Project["canvas"]>, sceneChanged: boolean) => void;
  dark: boolean;
  /** Where a beat wants the canvas pointed. */
  view: CanvasView | null;
  /** Bumped when a beat is applied, so the same view can be restored twice. */
  viewNonce: number;
  /** Reports where the canvas is now, so a beat can capture it. */
  onView: (v: CanvasView) => void;
}

export function CanvasPanel({ canvas, onChange, dark, view, viewNonce, onView }: Props) {
  const timer = useRef<number | null>(null);
  const contentVersion = useRef("");
  const syncing = useRef(false);
  const [api, setApi] = useState<CanvasApi | null>(null);
  const receiveApi = useCallback((instance: unknown) => setApi(instance as CanvasApi), []);
  const last = useRef<CanvasView | null>(null);
  useLayoutEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!api || !canvas) return;
    const version = sceneVersion(canvas.elements, canvas.files);
    if (contentVersion.current === version) return;
    if (timer.current) window.clearTimeout(timer.current);
    contentVersion.current = version;
    syncing.current = true;
    try {
      api.addFiles(Object.values(canvas.files ?? {}));
      api.updateScene({ elements: canvas.elements });
    } finally { syncing.current = false; }
  }, [api, canvas?.elements, canvas?.files]); // eslint-disable-line react-hooks/exhaustive-deps

  // A beat frames its own part of the drawing, rather than each beat needing its own canvas.
  useLayoutEffect(() => {
    if (!view || !api) return;
    api.updateScene({
      appState: { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom } },
    });
  }, [viewNonce, api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="canvas-host">
      <Excalidraw
        theme={dark ? "dark" : "light"}
        excalidrawAPI={receiveApi}
        initialData={{ elements: (canvas?.elements ?? []) as never, appState: { ...(canvas?.appState as object), ...(view ? { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom } } : {}), collaborators: new Map() } as never, files: canvas?.files as never }}
        onChange={(elements, appState, files) => {
          if (syncing.current) return;
          // Keep scene edits in project state before a beat can unmount this pane.
          const now = {
            scrollX: Math.round(appState.scrollX),
            scrollY: Math.round(appState.scrollY),
            zoom: appState.zoom?.value ?? 1,
          };
          const was = last.current;
          if (!was || was.scrollX !== now.scrollX || was.scrollY !== now.scrollY || was.zoom !== now.zoom) {
            last.current = now;
            onView(now);
          }

          if (timer.current) window.clearTimeout(timer.current);
          const { collaborators: _c, ...rest } = appState as unknown as Record<string, unknown>;
          const next = { elements: elements as unknown[], appState: rest, files: files as unknown as Record<string, unknown> };
          const version = sceneVersion(elements, files);
          if (version !== contentVersion.current) {
            contentVersion.current = version;
            onChange(next, true);
          } else {
            timer.current = window.setTimeout(() => onChange(next, false), 600);
          }
        }}
        UIOptions={{ canvasActions: { loadScene: false } }}
      />
    </div>
  );
}
