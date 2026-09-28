import assert from "node:assert/strict";
import test from "node:test";
import { explanationPdfHtml } from "../electron/explanation-pdf.js";

test("explanation PDF formats the conversation and keeps model HTML inert", () => {
  const html = explanationPdfHtml('# Explanation: Example\n\n## Highlighted passage\n\n> A <script>alert("x")</script>\n\n## Vajra\n\nThe answer & context.');
  assert.match(html, /<h1>Explanation: Example<\/h1>/);
  assert.match(html, /<blockquote>A &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;<\/blockquote>/);
  assert.match(html, /<h2>Vajra<\/h2>/);
  assert.match(html, /The answer &amp; context/);
  assert.doesNotMatch(html, /<script>/);
});
