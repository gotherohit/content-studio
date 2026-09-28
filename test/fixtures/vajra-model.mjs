// Local OpenAI-compatible response fixture for a scratch-profile desktop check.
import http from "node:http";

const port = Number(process.env.FIXTURE_PORT || 4810);
http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
  let body = "";
  for await (const chunk of req) body += chunk;
  const prompt = JSON.parse(body);
  const system = prompt.messages?.[0]?.content || "";
  const question = [...(prompt.messages || [])].reverse().find((message) => message.role === "user")?.content || "";
  const grounded = system.includes("https://example.org") && system.includes("Selected passage for this conversation");
  const answer = grounded ? `Fixture answer for “${question}”. The selected passage and example.org source are in context.` : "Fixture received incomplete source context.";
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}).listen(port, "127.0.0.1", () => console.log(`Vajra fixture on ${port}`));
