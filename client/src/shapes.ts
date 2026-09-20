// Shapes drawn over a source: a rectangle, an oval or an arrow, kept as fractions of whatever
// they were drawn on — a PDF page, an image, or the paragraph they sit over — so they survive
// zooming, a resized pane and a reflowed article. The geometry itself lives in plain
// JavaScript beside the injected script, which needs exactly the same maths inside the frame.

import type { Highlight } from "./types";

export {
  MIN_DRAG, fromDrag, toBox, arrowLine, arrowHead, badgeAt, shapeLabel,
} from "../../server/public/shapes-geom.js";
export type { Box, Point, Size } from "../../server/public/shapes-geom.js";

export const isShape = (h: Highlight) => Boolean(h.shape);

/** Highlights that mark text. Everything that lays marks over text must skip the shapes. */
export const textHighlights = (list: Highlight[]) => list.filter((h) => !h.shape);

export const shapeHighlights = (list: Highlight[]) => list.filter((h) => h.shape);
