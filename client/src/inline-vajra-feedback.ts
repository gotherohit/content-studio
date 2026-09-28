import type { ResearchSession } from "./research";

type ConversationState = Pick<ResearchSession, "status" | "lastError" | "messages">;

/** A saved partial answer must not look like a finished explanation when reopened. */
export function inlineVajraFeedback(session: ConversationState | null): { kind: "error" | "notice"; message: string } | null {
  if (!session || ["idle", "running", "complete"].includes(session.status)) return null;
  if (session.lastError) return { kind: "error", message: session.lastError };
  if (session.status === "limited") return { kind: "notice", message: "Vajra reached its step limit. Ask a follow-up to continue." };
  if (session.messages.at(-1)?.interrupted || ["error", "stopped", "interrupted"].includes(session.status))
    return { kind: "error", message: "Vajra stopped before finishing this answer. Ask a follow-up to continue." };
  return null;
}
