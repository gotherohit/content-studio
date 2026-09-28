import type { ResearchSession } from "./research";
import type { Highlight, Source } from "./types";
import type { SourceLink } from "./links";

const heading = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/([\\`*_\[\]])/g, "\\$1").trim();

/** A source artifact contains the useful exchange, not private tool arguments or approvals. */
export function explanationMarkdown(source: Source, highlight: Highlight, session: ResearchSession): string {
  const lines = [
    `# Explanation: ${heading(source.title)}`, "",
    `Source: ${source.url}`, `Selected passage: ${highlight.id}`, `Vajra conversation: ${session.id}`, "",
    "## Highlighted passage", "",
    ...highlight.text.trim().split(/\r?\n/).map((line) => `> ${line}`), "",
  ];
  for (const message of session.messages) {
    if (!message.content.trim()) continue;
    lines.push(`## ${message.role === "user" ? "Question" : "Vajra"}${message.interrupted ? " (interrupted)" : ""}`, "", message.content.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function explanationName(source: Source, session: ResearchSession, ext: "md" | "pdf"): string {
  const title = source.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Source";
  return `Explanation - ${title} - ${session.id.slice(0, 8)}.${ext}`;
}

export function explanationLink(sourceId: string, highlightId: string, explanationSourceId: string): SourceLink {
  return { id: `link${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    from: { sourceId, highlightId }, to: { sourceId: explanationSourceId }, relation: "explains", createdAt: new Date().toISOString() };
}
