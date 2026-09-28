import test from "node:test";
import assert from "node:assert/strict";
import { explanationLink, explanationMarkdown, explanationName } from "../client/src/explanations.ts";
import type { Source, Highlight } from "../client/src/types.ts";
import type { ResearchSession } from "../client/src/research.ts";

test("saved explanations keep attribution, passage and follow-ups without private tool activity", () => {
  const highlight = { id: "h1", text: "Distillation reduces a model.\nBut what is lost?", color: "yellow", comment: "", prefix: "", suffix: "", createdAt: "today" } as Highlight;
  const source = { id: "s1", title: "Distillation *guide*", url: "https://example.org/guide", highlights: [highlight] } as Source;
  const session = { id: "12345678-abcd", title: "Research", status: "complete", model: null, workspace: "", updatedAt: "today", activity: [{ id: "a", name: "read_source", arguments: "PRIVATE", status: "complete", createdAt: "today" }],
    messages: [{ role: "user", content: "Why?" }, { role: "assistant", content: "Because the student learns patterns." }, { role: "user", content: "What about errors?" }, { role: "assistant", content: "Errors may persist." }] } as ResearchSession;
  const markdown = explanationMarkdown(source, highlight, session);
  assert.match(markdown, /https:\/\/example.org\/guide/);
  assert.match(markdown, /> Distillation reduces a model\.\n> But what is lost\?/);
  assert.match(markdown, /## Question\n\nWhat about errors\?/);
  assert.match(markdown, /Errors may persist/);
  assert.ok(!markdown.includes("PRIVATE"));
  assert.equal(explanationName(source, session, "pdf"), "Explanation - Distillation guide - 12345678.pdf");
  const link = explanationLink("s1", "h1", "s2");
  assert.deepEqual({ from: link.from, to: link.to, relation: link.relation }, { from: { sourceId: "s1", highlightId: "h1" }, to: { sourceId: "s2" }, relation: "explains" });
});
