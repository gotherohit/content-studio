import type { ReadingPosition } from "../../client/src/types";
export function captureReadingPosition(root: Element, scroller: Element): ReadingPosition;
export function restoreReadingPosition(root: Element, scroller: Element, position: ReadingPosition): void;
export function trackReadingPosition(root: Element, scroller: Element, target: ReadingPosition | undefined, report: (position: ReadingPosition) => void): () => void;
