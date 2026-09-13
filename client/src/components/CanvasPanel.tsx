import { useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { CanvasView, Project } from "../types";

/** Only the part of Excalidraw's API this pane uses, so a version bump cannot break the import. */
type CanvasApi = { updateScene: (scene: { appState: Record<string, unknown> }) => void };

interface Props {
  canvas: Project["canvas"];
  onChange: (c: Project["canvas"]) => void;
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
  const api = useRef<CanvasApi | null>(null);
  const last = useRef<CanvasView | null>(null);

  // A beat frames its own part of the drawing, rather than each beat needing its own canvas.
  useEffect(() => {
    if (!view || !api.current) return;
    api.current.updateScene({
      appState: { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom } },
    });
  }, [viewNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="canvas-host">
      <Excalidraw
        theme={dark ? "dark" : "light"}
        excalidrawAPI={(instance: unknown) => (api.current = instance as CanvasApi)}
        initialData={canvas ? { elements: canvas.elements as never, appState: { ...(canvas.appState as object), collaborators: new Map() } as never, files: canvas.files as never } : undefined}
        onChange={(elements, appState, files) => {
          // Panning and zooming is reported at once; the drawing itself is saved on a pause.
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
          timer.current = window.setTimeout(() => {
            const { collaborators: _c, ...rest } = appState as unknown as Record<string, unknown>;
            onChange({ elements: elements as unknown[], appState: rest, files: files as unknown as Record<string, unknown> });
          }, 600);
        }}
        UIOptions={{ canvasActions: { loadScene: false } }}
      />
    </div>
  );
}
