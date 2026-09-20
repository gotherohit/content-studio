import type { Highlight } from "../../client/src/types";

export interface Anchored {
  host: HTMLElement;
  onImage?: string;
  anchor: { text: string; prefix: string; suffix: string };
}

export const BLOCK: string;
export function elementAt(doc: Document, x: number, y: number): HTMLElement | null;
export function imageAt(doc: Document, x: number, y: number): HTMLImageElement | null;
export function blockAt(doc: Document, root: HTMLElement, x: number, y: number): HTMLElement;
export function blockAnchor(root: HTMLElement, block: HTMLElement, limit?: number): { text: string; prefix: string; suffix: string } | null;
export function anchorAt(doc: Document, root: HTMLElement, x: number, y: number): Anchored | null;
export function hostFor(root: HTMLElement, h: Highlight): HTMLElement | null;
export function boxWithin(container: HTMLElement, el: HTMLElement): { left: number; top: number; width: number; height: number };
