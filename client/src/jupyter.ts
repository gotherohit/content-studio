/**
 * Where a Jupyter pane belongs, and what to do when the server is somewhere else.
 *
 * One JupyterLab serves the whole app and its root cannot change without a restart, so a
 * pane can only ever ask. These rules live here rather than in the component because a beat
 * that puts the notebook back in the wrong folder is the kind of thing that is only noticed
 * on camera.
 */

/** Trailing separators, slash direction and case all differ between a picker and a saved path. */
const plain = (dir: string) => dir.replace(/[\\/]+$/, "").split("\\").join("/").toLowerCase();

export const sameFolder = (a?: string | null, b?: string | null) =>
  Boolean(a && b) && plain(String(a)) === plain(String(b));

/** The folder a pane should show: the beat's, then the project's choice, then the project itself. */
export function rootFor(
  view: { jupyterRoot?: string } | undefined,
  settings: { jupyterRoot?: string } | undefined,
  projectDir: string | undefined,
): string {
  return view?.jupyterRoot || settings?.jupyterRoot || projectDir || "";
}

export type JupyterPlan =
  /** The server is rooted where this pane wants it. */
  | "showing"
  /** Nothing is running; the pane offers to start in that folder. */
  | "idle"
  /** Rooted elsewhere with nothing to lose, so the pane may move it itself. */
  | "switch"
  /** Rooted elsewhere with live kernels: say so and let the person decide. */
  | "ask";

/**
 * A restart takes the kernels with it, and this app is used while recording, so the pane
 * only moves the server on its own when no kernel is alive. With one running it asks.
 */
export function planFor(
  status: { running: boolean; rootDir?: string | null } | null,
  wanted: string,
  kernels: number,
): JupyterPlan {
  if (!status?.running) return "idle";
  if (!wanted || sameFolder(status.rootDir, wanted)) return "showing";
  return kernels > 0 ? "ask" : "switch";
}

/** The last part of a path, for naming a folder in a toolbar. */
export const folderName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
