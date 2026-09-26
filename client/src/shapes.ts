// Shapes drawn over a source — boxes, lines, arrows, callouts — kept as fractions of whatever
// they were drawn on — a PDF page, an image, or the paragraph they sit over — so they survive
// zooming, a resized pane and a reflowed article. The geometry itself lives in plain
// JavaScript beside the injected script, which needs exactly the same maths inside the frame.

import type { Highlight } from "./types";

export {
  MIN_DRAG, SHAPE_KINDS, COLOURS, PALETTE, isLine, fromDrag, toBox, arrowLine, arrowHead, badgeAt, shapeLabel,
  resolveStyle, paint, dashArray, inkOn, calloutBody, calloutFont, shapePath, shapeHeads,
} from "../../server/public/shapes-geom.js";
export type { Box, Point, Size, ResolvedStyle } from "../../server/public/shapes-geom.js";

export const isShape = (h: Highlight) => Boolean(h.shape);

/** Highlights that mark text. Everything that lays marks over text must skip the shapes. */
export const textHighlights = (list: Highlight[]) => list.filter((h) => !h.shape);

export const shapeHighlights = (list: Highlight[]) => list.filter((h) => h.shape);
