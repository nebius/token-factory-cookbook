// Each bot's memory is one Markdown file: data/workspaces/<botId>/MEMORY.md.
// You can open and edit it in any editor; the bot reads it at the start of
// every turn and changes it through two small tools.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACES_DIR } from "./config";

/** How much of MEMORY.md goes into the prompt. The file itself can be longer. */
export const MEMORY_PROMPT_LIMIT = { lines: 200, bytes: 16 * 1024 };

export function workspaceDir(botId: string): string {
  const dir = join(WORKSPACES_DIR, botId.replace(/[^a-zA-Z0-9_-]/g, ""));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryPath(botId: string): string {
  return join(workspaceDir(botId), "MEMORY.md");
}

export function readMemory(botId: string): string {
  const path = memoryPath(botId);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk|tvly|ak|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi,
];

/** Bots sometimes "helpfully" remember a key they saw. They don't get to keep it. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (m) => `«redacted ${m.length} chars»`);
  }
  return out;
}

export function writeMemory(botId: string, content: string): string {
  const path = memoryPath(botId);
  const clean = redactSecrets(content);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, clean, { mode: 0o600 });
  renameSync(tmp, path);
  return clean;
}

export function deleteWorkspace(botId: string): void {
  rmSync(workspaceDir(botId), { recursive: true, force: true });
}

/** The slice of MEMORY.md that loads into the prompt, and whether it was cut. */
export function memoryForPrompt(botId: string): { text: string; truncated: boolean } {
  const full = readMemory(botId);
  let text = full.split("\n").slice(0, MEMORY_PROMPT_LIMIT.lines).join("\n");
  if (Buffer.byteLength(text) > MEMORY_PROMPT_LIMIT.bytes) {
    text = Buffer.from(text).subarray(0, MEMORY_PROMPT_LIMIT.bytes).toString("utf8");
  }
  return { text: text.trim(), truncated: text.length < full.trimEnd().length };
}

export function appendMemory(botId: string, note: string, section?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const line = `- ${note.trim().replace(/\n+/g, " ")} _(${today})_`;
  let content = readMemory(botId).trimEnd();
  if (section) {
    const heading = `## ${section.trim()}`;
    const idx = content.split("\n").findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
    if (idx >= 0) {
      const lines = content.split("\n");
      let end = idx + 1;
      while (end < lines.length && !lines[end].startsWith("## ")) end++;
      while (end > idx + 1 && lines[end - 1].trim() === "") end--;
      lines.splice(end, 0, line);
      content = lines.join("\n");
    } else {
      content = `${content}${content ? "\n\n" : ""}${heading}\n${line}`;
    }
  } else {
    const afterHeading = /(^|\n)#[^\n]*$/.test(content);
    content = `${content}${content ? (afterHeading ? "\n\n" : "\n") : ""}${line}`;
  }
  return writeMemory(botId, `${content}\n`);
}

export function editMemory(botId: string, find: string, replace: string): { ok: boolean; reason?: string } {
  const content = readMemory(botId);
  const count = content.split(find).length - 1;
  if (!find || count === 0) return { ok: false, reason: "That exact text isn't in MEMORY.md. Read it again and copy the text exactly." };
  if (count > 1) return { ok: false, reason: `That text appears ${count} times. Include more surrounding words so it matches once.` };
  writeMemory(botId, content.replace(find, replace));
  return { ok: true };
}
