import test from "node:test";
import assert from "node:assert/strict";
import { MIN_DRAG, arrowHead, arrowLine, badgeAt, fromDrag, shapeLabel, shapeHighlights, textHighlights, toBox } from "../client/src/shapes.ts";
import type { Highlight } from "../client/src/types.ts";

const size = { width: 200, height: 100 };

test("a drag becomes fractions of the box it happened in", () => {
  const s = fromDrag("rect", { x: 20, y: 10 }, { x: 120, y: 60 }, size)!;
  assert.deepEqual(s, { kind: "rect", x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
});

test("a rectangle drawn backwards is normalised, an arrow keeps its direction", () => {
  const box = fromDrag("oval", { x: 120, y: 60 }, { x: 20, y: 10 }, size)!;
  assert.deepEqual(box, { kind: "oval", x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  const arrow = fromDrag("arrow", { x: 120, y: 60 }, { x: 20, y: 10 }, size)!;
  assert.deepEqual(arrow, { kind: "arrow", x: 0.6, y: 0.6, w: -0.5, h: -0.5 });
});

test("a click is not a drawing", () => {
  assert.equal(fromDrag("rect", { x: 20, y: 10 }, { x: 20 + MIN_DRAG - 1, y: 12 }, size), null);
  assert.equal(fromDrag("rect", { x: 0, y: 0 }, { x: 0, y: 0 }, size), null);
  assert.equal(fromDrag("rect", { x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 }), null);
});

test("a shape may spill outside what it is drawn on, but only so far", () => {
  // Drawing a box around a paragraph starts in the margin and ends past its far corner.
  const around = fromDrag("rect", { x: -20, y: -10 }, { x: 220, y: 110 }, size)!;
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ~ ${b}`);
  near(around.x, -0.1); near(around.y, -0.1); near(around.w, 1.2); near(around.h, 1.2);
  // A drag from far outside is still pulled back to one box beyond the edge.
  const wild = fromDrag("rect", { x: -400, y: -300 }, { x: 900, y: 700 }, size)!;
  assert.deepEqual(wild, { kind: "rect", x: -1, y: -1, w: 3, h: 3 });
});

test("a shape is put back in pixels, whichever way it was drawn", () => {
  assert.deepEqual(toBox({ kind: "rect", x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, size), { left: 20, top: 20, width: 100, height: 50 });
  // An arrow pointing up and left still has a positive box.
  const back = toBox({ kind: "arrow", x: 0.6, y: 0.7, w: -0.5, h: -0.5 }, size);
  assert.ok(Math.abs(back.left - 20) < 1e-9 && Math.abs(back.top - 20) < 1e-9, JSON.stringify(back));
  assert.deepEqual([back.width, back.height], [100, 50]);
});

test("an arrow runs from its tail to its head", () => {
  const arrow = { kind: "arrow" as const, x: 0.6, y: 0.7, w: -0.5, h: -0.5 };
  const line = arrowLine(arrow, size);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ~ ${b}`);
  near(line.x1, 120); near(line.y1, 70); near(line.x2, 20); near(line.y2, 20);
  const head = arrowHead(arrow, size);
  near(head[1].x, 20); near(head[1].y, 20);
  // Both barbs sit behind the point, on the tail's side of it.
  assert.ok(head[0].x > 20 && head[2].x > 20);
  assert.ok(head[0].y > 20 && head[2].y > 20);
});

test("the badge sits at the corner of a box and at the point of an arrow", () => {
  assert.deepEqual(badgeAt({ kind: "rect", x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, size), { x: 120, y: 20 });
  assert.deepEqual(badgeAt({ kind: "arrow", x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, size), { x: 100, y: 50 });
});

test("shapes and quotes are told apart, so marks are only laid over text", () => {
  const list = [
    { id: "a", text: "quoted" },
    { id: "b", text: "", shape: { kind: "rect", x: 0, y: 0, w: 0.2, h: 0.2 } },
  ] as unknown as Highlight[];
  assert.deepEqual(textHighlights(list).map((h) => h.id), ["a"]);
  assert.deepEqual(shapeHighlights(list).map((h) => h.id), ["b"]);
});

test("a shape says what it is", () => {
  assert.equal(shapeLabel("rect"), "Rectangle");
  assert.equal(shapeLabel("oval"), "Oval");
  assert.equal(shapeLabel("arrow"), "Arrow");
});
