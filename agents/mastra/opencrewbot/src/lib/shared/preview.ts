import type { ChatMessage } from "./types";

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
