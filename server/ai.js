// Talking to whichever model the creator picked.
//
// Two wire protocols cover essentially every provider worth pointing at: Anthropic's
// Messages API, and the OpenAI chat-completions shape that OpenRouter, DeepSeek, Groq,
// Together, Gemini, xAI, Ollama and LM Studio all imitate. Both are streamed, because a
// long answer that arrives all at once feels broken and can hit a request timeout.
//
// Keys are read from the credential store at the moment of the call and never returned,
// logged, or echoed into an error message.
import Anthropic from "@anthropic-ai/sdk";

const MAX_TOKENS = 16000;

/** Strip anything that might carry a key out of a provider's error text. */
const scrub = (message = "", key = "") => {
  let out = String(message);
  if (key) out = out.split(key).join("[key]");
  return out.replace(/\b(sk|xai|gsk|or)-[A-Za-z0-9_-]{8,}/g, "[key]").slice(0, 600);
};

/**
 * Stream a reply.
 *
 * @param onText  called with each fragment of prose as it arrives
 * @returns       what the provider said about how it finished
 */
export async function streamChat({ provider, model, system, messages, onText, signal }) {
  return provider.kind === "anthropic"
    ? viaAnthropic({ provider, model, system, messages, onText, signal })
    : viaOpenAI({ provider, model, system, messages, onText, signal });
}

async function viaAnthropic({ provider, model, system, messages, onText, signal }) {
  const client = new Anthropic({ apiKey: provider.apiKey ?? "unused", baseURL: provider.baseUrl || undefined });
  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        // The source material is long and constant across a conversation, so it is worth
        // caching: the same article is not re-billed on every follow-up question.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
    }
    const final = await stream.finalMessage();
    return { stopReason: final.stop_reason, usage: final.usage };
  } catch (e) {
    throw new Error(scrub(e?.message, provider.apiKey));
  }
}

async function viaOpenAI({ provider, model, system, messages, onText, signal }) {
  const headers = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;

  let r;
  try {
    r = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach ${provider.label}: ${scrub(e?.message, provider.apiKey)}`);
  }

  if (!r.ok || !r.body) {
    const body = await r.text().catch(() => "");
    throw new Error(`${provider.label} returned ${r.status}: ${scrub(readError(body), provider.apiKey)}`);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", usage = null, stopReason = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      const choice = ev.choices?.[0];
      // Reasoning models stream their thinking separately; only the answer is shown.
      const text = choice?.delta?.content;
      if (text) onText(text);
      if (choice?.finish_reason) stopReason = choice.finish_reason;
      if (ev.usage) usage = ev.usage;
    }
  }
  return { stopReason, usage };
}

/** Providers wrap failures differently; find the sentence a human should read. */
function readError(body) {
  try {
    const j = JSON.parse(body);
    return j.error?.message ?? j.message ?? j.error ?? body;
  } catch {
    return body;
  }
}

/** Ask a provider what it can run, so models need not be typed by hand. */
export async function listModels(provider) {
  const headers = {};
  if (provider.kind === "anthropic") {
    headers["x-api-key"] = provider.apiKey ?? "";
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider.apiKey) {
    headers.authorization = `Bearer ${provider.apiKey}`;
  }

  const base = provider.kind === "anthropic" ? `${provider.baseUrl}/v1/models` : `${provider.baseUrl}/models`;
  const r = await fetch(base, { headers }).catch((e) => {
    throw new Error(`Could not reach ${provider.label}: ${scrub(e?.message, provider.apiKey)}`);
  });
  if (!r.ok) {
    throw new Error(`${provider.label} returned ${r.status}: ${scrub(readError(await r.text().catch(() => "")), provider.apiKey)}`);
  }
  const j = await r.json();
  const rows = j.data ?? j.models ?? [];
  return rows.map((m) => m.id ?? m.name).filter(Boolean).sort();
}
