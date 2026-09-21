import assert from "node:assert/strict";
import { test } from "node:test";
import { folderName, planFor, rootFor, sameFolder } from "../client/src/jupyter.ts";

const running = (rootDir: string) => ({ running: true, rootDir });

test("a pane takes the beat's folder first, then the project's choice, then the project itself", () => {
  assert.equal(rootFor({ jupyterRoot: "D:/experiments" }, { jupyterRoot: "D:/lab" }, "D:/projects/one"), "D:/experiments");
  assert.equal(rootFor({}, { jupyterRoot: "D:/lab" }, "D:/projects/one"), "D:/lab");
  assert.equal(rootFor(undefined, {}, "D:/projects/one"), "D:/projects/one");
  assert.equal(rootFor(undefined, undefined, undefined), "");
});

test("the same folder written two ways is one folder", () => {
  assert.equal(sameFolder("D:/lab", "D:\\lab"), true);
  assert.equal(sameFolder("D:/lab/", "D:/LAB"), true);
  assert.equal(sameFolder("D:/lab", "D:/lab2"), false);
  assert.equal(sameFolder("", "D:/lab"), false);
  assert.equal(sameFolder(null, null), false);
});

test("the pane moves Jupyter itself only when no kernel would be lost", () => {
  // Nothing running: the pane offers to start, it does not start on its own.
  assert.equal(planFor({ running: false, rootDir: null }, "D:/lab", 0), "idle");
  assert.equal(planFor(null, "D:/lab", 0), "idle");
  // Already in the right place, whichever way the path is written.
  assert.equal(planFor(running("D:\\lab"), "D:/lab/", 0), "showing");
  // Somewhere else and nothing to lose: move it.
  assert.equal(planFor(running("D:/projects/one"), "D:/lab", 0), "switch");
  // Somewhere else with a live kernel: a restart would take it, so ask.
  assert.equal(planFor(running("D:/projects/one"), "D:/lab", 1), "ask");
});

test("a folder is named by its last part", () => {
  assert.equal(folderName("D:/experiments/calibration"), "calibration");
  assert.equal(folderName("D:\\experiments\\calibration\\"), "calibration");
  assert.equal(folderName("D:/"), "D:");
});
