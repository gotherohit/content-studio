import { useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { Project } from "../types";

interface Props {
  canvas: Project["canvas"];
  onChange: (c: Project["canvas"]) => void;
  dark: boolean;
}

export function CanvasPanel({ canvas, onChange, dark }: Props) {
  const timer = useRef<number | null>(null);
  return (
    <div className="canvas-host">
      <Excalidraw
        theme={dark ? "dark" : "light"}
        initialData={canvas ? { elements: canvas.elements as never, appState: { ...(canvas.appState as object), collaborators: new Map() } as never, files: canvas.files as never } : undefined}
        onChange={(elements, appState, files) => {
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
