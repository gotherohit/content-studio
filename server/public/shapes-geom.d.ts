import type { HighlightColor, Shape, ShapeDash, ShapeKind, ShapePaint } from "../../client/src/types";

export interface Size { width: number; height: number }
export interface Box { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

export interface ResolvedStyle {
  fill: ShapePaint;
  fillOpacity: number;
  stroke: ShapePaint;
  width: number;
  dash: ShapeDash;
}

export const MIN_DRAG: number;
export const SHAPE_KINDS: ShapeKind[];
export const COLOURS: Record<HighlightColor, string>;
export const PALETTE: HighlightColor[];
export function isLine(kind: ShapeKind): boolean;
export function fromDrag(kind: ShapeKind, from: Point, to: Point, size: Size): Shape | null;
export function toBox(shape: Shape, size: Size): Box;
export function arrowLine(shape: Shape, size: Size): { x1: number; y1: number; x2: number; y2: number };
export function arrowHead(shape: Shape, size: Size, length?: number): Point[];
export function resolveStyle(shape: Shape): ResolvedStyle;
export function paint(name: ShapePaint | undefined, own: HighlightColor): string | null;
export function dashArray(dash: ShapeDash, width: number): string;
export function inkOn(hex: string): string;
export function calloutBody(shape: Shape, size: Size): Box;
export function calloutFont(body: Box, text: string): number;
export function shapePath(shape: Shape, size: Size): string;
export function shapeHeads(shape: Shape, size: Size): string[];
export function badgeAt(shape: Shape, size: Size): Point;
export function shapeLabel(kind: ShapeKind): string;
