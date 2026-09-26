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

// ---- the wider set of shapes, and how they are painted

import {
  COLOURS, PALETTE, SHAPE_KINDS, calloutBody, calloutFont, dashArray, inkOn, isLine, paint, resolveStyle, shapeHeads, shapePath,
} from "../client/src/shapes.ts";
import type { Shape, ShapeKind } from "../client/src/types.ts";

const box = (kind: ShapeKind, extra: Partial<Shape> = {}): Shape => ({ kind, x: 0.1, y: 0.2, w: 0.5, h: 0.6, ...extra });

test("every kind has an outline: a box is closed, a line is open", () => {
  for (const kind of SHAPE_KINDS) {
    const d = shapePath(box(kind), size);
    assert.ok(d.startsWith("M"), `${kind}: ${d}`);
    assert.equal(/Z$/.test(d), !isLine(kind), `${kind} closed=${!isLine(kind)}: ${d}`);
    assert.ok(!/NaN|Infinity/.test(d), `${kind}: ${d}`);
  }
});

test("every line keeps its direction, every box is normalised", () => {
  for (const kind of SHAPE_KINDS) {
    const s = fromDrag(kind, { x: 120, y: 60 }, { x: 20, y: 10 }, size)!;
    if (isLine(kind)) assert.ok(s.w < 0 && s.h < 0, kind);
    else assert.ok(s.w > 0 && s.h > 0, kind);
  }
});

test("an arrow has one head, a double arrow two, anything else none", () => {
  const line = { kind: "arrow" as const, x: 0.1, y: 0.5, w: 0.8, h: 0 };
  assert.equal(shapeHeads(line, size).length, 1);
  assert.equal(shapeHeads({ ...line, kind: "darrow" }, size).length, 2);
  assert.equal(shapeHeads({ ...line, kind: "line" }, size).length, 0);
  assert.equal(shapeHeads(box("rect"), size).length, 0);
  // The second head of a double arrow sits at the tail, pointing the other way.
  const [, tail] = shapeHeads({ ...line, kind: "darrow" }, size);
  assert.match(tail, /^M[\d.]+ [\d.]+L20 50L/, tail);
});

test("an arrow head grows with its line, so a thick arrow does not end in a pin", () => {
  const thin = shapeHeads({ kind: "arrow", x: 0, y: 0.5, w: 1, h: 0, width: 2 }, size)[0];
  const thick = shapeHeads({ kind: "arrow", x: 0, y: 0.5, w: 1, h: 0, width: 10 }, size)[0];
  const back = (d: string) => Number(/^M([\d.]+)/.exec(d)![1]);
  assert.ok(back(thick) < back(thin), `${thick} vs ${thin}`);
});

test("a drawing made before styles existed looks exactly as it did", () => {
  for (const kind of ["rect", "oval", "arrow"] as const) {
    assert.deepEqual(resolveStyle(box(kind)), { fill: "none", fillOpacity: 0.25, stroke: "match", width: 2.5, dash: "solid" }, kind);
  }
});

test("a highlighter is a see-through wash with no border; a callout is readable over anything", () => {
  assert.deepEqual(resolveStyle(box("marker")), { fill: "match", fillOpacity: 0.35, stroke: "none", width: 2.5, dash: "solid" });
  const callout = resolveStyle(box("callout"));
  assert.equal(callout.fill, "white");
  assert.ok(callout.fillOpacity > 0.9);
  assert.equal(callout.stroke, "match");
});

test("a style set on a drawing wins, and nonsense is kept in bounds", () => {
  const s = resolveStyle(box("rect", { fill: "red", fillOpacity: 0.5, stroke: "none", width: 6, dash: "dotted" }));
  assert.deepEqual(s, { fill: "red", fillOpacity: 0.5, stroke: "none", width: 6, dash: "dotted" });
  assert.equal(resolveStyle(box("rect", { fillOpacity: 4 })).fillOpacity, 1);
  assert.equal(resolveStyle(box("rect", { fillOpacity: -1 })).fillOpacity, 0);
  assert.equal(resolveStyle(box("rect", { width: 100 })).width, 12);
  assert.equal(resolveStyle(box("rect", { width: 0 })).width, 1);
});

test("paint: the drawing's own colour, a palette colour, or nothing", () => {
  assert.equal(paint("match", "red"), COLOURS.red);
  assert.equal(paint("blue", "red"), COLOURS.blue);
  assert.equal(paint("none", "red"), null);
  assert.equal(paint(undefined, "red"), null);
  assert.equal(PALETTE.length, 9);
  for (const c of PALETTE) assert.match(COLOURS[c], /^#[0-9a-f]{6}$/);
});

test("dashes are sized to the line, so a thick dotted line still reads as dots", () => {
  assert.equal(dashArray("solid", 3), "");
  assert.equal(dashArray("dashed", 2), "6 4");
  assert.equal(dashArray("dashed", 6), "18 12");
  assert.match(dashArray("dotted", 4), /^0\.01 8$/);
});

test("a callout's words are dark on a light fill and light on a dark one", () => {
  assert.equal(inkOn(COLOURS.white), "#1f2328");
  assert.equal(inkOn(COLOURS.yellow), "#1f2328");
  assert.equal(inkOn(COLOURS.black), "#ffffff");
  assert.equal(inkOn(COLOURS.purple), "#ffffff");
});

test("a callout's text sits above its tail, inside the box it was drawn as", () => {
  const c = box("callout");
  const whole = toBox(c, size);
  const body = calloutBody(c, size);
  assert.equal(body.left, whole.left);
  assert.equal(body.top, whole.top);
  assert.ok(body.height < whole.height && body.height > whole.height / 2, JSON.stringify(body));
});

test("a line's marker sits at its end, a box's at its corner", () => {
  assert.deepEqual(badgeAt({ kind: "line", x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, size), { x: 100, y: 50 });
  assert.deepEqual(badgeAt({ kind: "darrow", x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, size), { x: 100, y: 50 });
  assert.deepEqual(badgeAt(box("star"), size), { x: 120, y: 20 });
});

test("every kind says what it is", () => {
  const labels = SHAPE_KINDS.map((k) => shapeLabel(k));
  assert.ok(!labels.includes("Shape"), labels.join());
  assert.equal(shapeLabel("marker"), "Highlighter");
  assert.equal(shapeLabel("darrow"), "Double arrow");
  assert.equal(new Set(labels).size, SHAPE_KINDS.length);
});

test("a callout's words shrink to fit a small box and grow in a big one, within readable bounds", () => {
  const note = "A callout says its note right here";
  const small = calloutFont({ left: 0, top: 0, width: 60, height: 50 }, note);
  const roomy = calloutFont({ left: 0, top: 0, width: 320, height: 140 }, note);
  assert.ok(small < roomy, `${small} < ${roomy}`);
  assert.equal(small, 9, "never below what reads on a recording");
  assert.equal(calloutFont({ left: 0, top: 0, width: 2000, height: 900 }, "Hi"), 18, "never above a heading");
  // A longer note in the same box is set smaller.
  assert.ok(calloutFont({ left: 0, top: 0, width: 240, height: 90 }, note.repeat(3)) < calloutFont({ left: 0, top: 0, width: 240, height: 90 }, note));
});
