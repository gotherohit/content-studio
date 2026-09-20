import type { Shape, ShapeKind } from "../../client/src/types";

export interface Size { width: number; height: number }
export interface Box { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

export const MIN_DRAG: number;
export function fromDrag(kind: ShapeKind, from: Point, to: Point, size: Size): Shape | null;
export function toBox(shape: Shape, size: Size): Box;
export function arrowLine(shape: Shape, size: Size): { x1: number; y1: number; x2: number; y2: number };
export function arrowHead(shape: Shape, size: Size, length?: number): Point[];
export function badgeAt(shape: Shape, size: Size): Point;
export function shapeLabel(kind: ShapeKind): string;
