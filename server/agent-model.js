import Anthropic from "@anthropic-ai/sdk";

export function redact(message, key = "") {
  const text = key ? String(message).split(key).join("[key]") : String(message);
  return text.replace(/\b(?:sk|tvly|xai|gsk)-[\w-]{8,}/g, "[key]").slice(0, 1000);
}

/** Decode complete SSE events, including a final event without a trailing newline. */
export async function* sse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        yield buffer.slice(0, end).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        buffer = buffer.slice(end + 2);
      }
      if (done) {
        if (buffer.trim()) yield buffer.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function anthropicMessages(messages) {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content, is_error: Boolean(m.error) }] };
    if (m.role === "assistant" && m.anthropicContent) return { role: "assistant", content: m.anthropicContent };
    if (m.role === "assistant" && m.toolCalls?.length) return { role: "assistant", content: [
      ...(m.content ? [{ type: "text", text: m.content }] : []),
      ...m.toolCalls.map((t) => {
        let input; try { input = JSON.parse(t.arguments); } catch { input = { invalid_arguments: t.arguments }; }
        return { type: "tool_use", id: t.id, name: t.name, input };
      }),
    ] };
    return { role: m.role, content: m.content || "(No text)" };
  });
}

export function openaiMessages(messages) {
  return messages.map((m) => m.role === "tool"
    ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
    : { role: m.role, content: m.content || null,
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) } : {}),
      ...(m.reasoningDetails?.length ? { reasoning_details: m.reasoningDetails } : {}),
    });
}

/** One model step. The harness, rather than the provider, executes local tools. */
export async function agentStep({ provider, model, system, messages, tools, signal, onText }) {
  try {
    if (provider.kind === "anthropic") {
      const client = new Anthropic({ apiKey: provider.apiKey || "unused", baseURL: provider.baseUrl || undefined });
      const stream = client.messages.stream({ model, max_tokens: 8192, system, messages: anthropicMessages(messages),
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }, { signal });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
      }
      const final = await stream.finalMessage();
      return { role: "assistant", content: final.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
        anthropicContent: final.content,
        toolCalls: final.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) })),
        usage: final.usage, stopReason: final.stop_reason };
    }
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 8192, stream: true,
        messages: [{ role: "system", content: system }, ...openaiMessages(messages)],
        tools: tools.map((t) => ({ type: "function", function: t })),
      }),
    });
    if (!response.ok || !response.body) throw new Error(`${provider.label} returned ${response.status}: ${(await response.text()).slice(0, 1000)}`);
    let content = "", stopReason = null, usage = null;
    const calls = new Map(), reasoning = new Map();
    for await (const data of sse(response.body)) {
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.error) throw new Error(event.error.message || "Provider stream failed");
      const choice = event.choices?.[0];
      if (choice?.delta?.content) { content += choice.delta.content; onText(choice.delta.content); }
      for (const t of choice?.delta?.tool_calls || []) {
        const call = calls.get(t.index) || { id: "", name: "", arguments: "" };
        if (t.id) call.id = t.id;
        if (t.function?.name) call.name += t.function.name;
        if (t.function?.arguments) call.arguments += t.function.arguments;
        calls.set(t.index, call);
      }
      for (const detail of choice?.delta?.reasoning_details || []) {
        const index = detail.index ?? 0;
        const prior = reasoning.get(index) || {};
        const next = { ...prior, ...detail };
        for (const key of ["text", "data", "signature", "summary"]) {
          if (typeof detail[key] === "string") next[key] = (prior[key] || "") + detail[key];
        }
        reasoning.set(index, next);
      }
      stopReason = choice?.finish_reason || stopReason;
      usage = event.usage || usage;
    }
    if (!stopReason) throw new Error("The model stream ended before completing its response. Retry the turn.");
    return { role: "assistant", content, toolCalls: [...calls.values()], reasoningDetails: [...reasoning.values()], stopReason, usage };
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    throw new Error(redact(error.message, provider.apiKey));
  }
}
