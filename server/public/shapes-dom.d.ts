import type { Highlight } from "../../client/src/types";

export type ShapeHost = Pick<HTMLElement, "getBoundingClientRect" | "scrollIntoView">;
export interface Anchored {
  host: ShapeHost;
  onImage?: string;
  anchor: { text: string; prefix: string; suffix: string; blocks?: { text: string; prefix: string; suffix: string }[] };
}

export const BLOCK: string;
export function elementAt(doc: Document, x: number, y: number): HTMLElement | null;
export function imageAt(doc: Document, x: number, y: number): HTMLImageElement | null;
export function blockAt(doc: Document, root: HTMLElement, x: number, y: number): HTMLElement;
export function blockAnchor(root: HTMLElement, block: HTMLElement, limit?: number): { text: string; prefix: string; suffix: string } | null;
export function anchorForRect(doc: Document, root: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }): Anchored;
export function anchorAt(doc: Document, root: HTMLElement, x: number, y: number): Anchored | null;
export function hostFor(root: HTMLElement, h: Highlight): ShapeHost | null;
export function boxWithin(container: HTMLElement, el: ShapeHost): { left: number; top: number; width: number; height: number };
