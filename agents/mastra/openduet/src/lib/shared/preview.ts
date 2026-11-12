import type { ChatMessage, WaitingItem } from "./types";

/** An action label as the rest of a sentence: "Gmail: send email" → "send email in
 * Gmail", "Open a page" → "open a page". Reads after "Quill wants to …". */
export function actionPhrase(label: string): string {
  const app = label.match(/^([^:]+):\s*(.+)$/);
  if (app) return `${app[2]} in ${app[1]}`;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** What this message is waiting on the person for, if anything. */
export function waitingIn(message: ChatMessage): WaitingItem | null {
  if (message.role !== "bot" || message.status !== "streaming" || !message.botId) return null;
  for (const p of message.parts) {
    if (p.kind === "tool" && p.status === "awaiting-approval") {
      return { messageId: message.id, botId: message.botId, label: p.detail ? `${p.label} ${p.detail}` : p.label, kind: "approval" };
    }
    if (p.kind === "question" && p.answer === undefined) {
      return { messageId: message.id, botId: message.botId, label: p.question, kind: "question" };
    }
  }
  return null;
}

/** One plain-text line for sidebar previews: Markdown marks and newlines removed. */
export function messagePreview(message: ChatMessage): string {
  const text = message.parts
    .filter((p) => p.kind === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const tool = message.parts.find((p) => p.kind === "tool");
  if (tool && tool.kind === "tool") return tool.label;
  if (message.parts.some((p) => p.kind === "question")) return "Asked you a question";
  return message.error ? "Error" : "";
}
