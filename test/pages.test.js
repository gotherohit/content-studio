import assert from "node:assert/strict";
import { test } from "node:test";
import { pageKey, realUrl, samePage, sameSite, stepPage, visitPage } from "../server/public/pages.js";

test("a fragment, a trailing slash or the scripts switch does not make a different page", () => {
  assert.ok(samePage("https://docs.typesafe.ai/introduction#setup", "https://docs.typesafe.ai/introduction/"));
  assert.ok(samePage("https://docs.typesafe.ai/intro?__rs_scripts=0", "https://docs.typesafe.ai/intro"));
  assert.ok(!samePage("https://docs.typesafe.ai/introduction", "https://docs.typesafe.ai/quickstart"));
  assert.ok(!samePage("https://docs.typesafe.ai/a?page=1", "https://docs.typesafe.ai/a?page=2"));
  assert.ok(!samePage(undefined, "https://docs.typesafe.ai/a"));
  assert.equal(pageKey("https://Docs.Typesafe.ai/"), "https://docs.typesafe.ai/");
});

test("a proxied address maps back to the real page", () => {
  assert.equal(realUrl("http://docs--typesafe--ai.localhost:4700/quickstart?x=1&__rs_scripts=0#top"), "https://docs.typesafe.ai/quickstart?x=1#top");
  assert.equal(realUrl("https://example.com/a"), "https://example.com/a");
});

test("another subdomain is another site", () => {
  assert.ok(sameSite("https://docs.typesafe.ai/a", "https://docs.typesafe.ai/b"));
  assert.ok(!sameSite("https://docs.typesafe.ai/a", "https://www.typesafe.ai/a"));
});

test("the pane's own history goes back and forward, and a new page drops the forward pages", () => {
  let trail = { list: ["https://d.ai/intro"], at: 0 };
  trail = visitPage(trail, "https://d.ai/quickstart");
  trail = visitPage(trail, "https://d.ai/install");
  assert.deepEqual(trail, { list: ["https://d.ai/intro", "https://d.ai/quickstart", "https://d.ai/install"], at: 2 });
  trail = stepPage(trail, -1);
  assert.equal(trail.list[trail.at], "https://d.ai/quickstart");
  // Arriving where Back already points is not a new visit.
  assert.equal(visitPage(trail, "https://d.ai/quickstart#faq"), trail);
  trail = visitPage(trail, "https://d.ai/pricing");
  assert.deepEqual(trail.list, ["https://d.ai/intro", "https://d.ai/quickstart", "https://d.ai/pricing"]);
  assert.equal(stepPage(stepPage(trail, 5), 5).at, 2);
  assert.equal(stepPage({ list: ["a"], at: 0 }, -1).at, 0);
});
