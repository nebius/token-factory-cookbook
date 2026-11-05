// Files that look like they hold credentials (API keys, private keys, tokens) are never sent to the model.
// Uses Secretlint's recommended rule set, the same one Repomix uses.
import { lintSource } from "@secretlint/core";
import { creator as recommended } from "@secretlint/secretlint-rule-preset-recommend";
import type { RepoFile } from "./github";

const config = { rules: [{ id: "@secretlint/secretlint-rule-preset-recommend", rule: recommended }] };

/** Paths of files with at least one likely secret. */
export async function findSecrets(files: RepoFile[]): Promise<Set<string>> {
  const flagged = new Set<string>();
  for (const f of files) {
    try {
      const result = await lintSource({
        source: { content: f.text, filePath: f.path, ext: f.path.includes(".") ? `.${f.path.split(".").pop()}` : "", contentType: "text" },
        options: { config, noPhysicFilePath: true, maskSecrets: true },
      });
      if (result.messages.length > 0) flagged.add(f.path);
    } catch {
      // A rule failing on odd input shouldn't block the read.
    }
  }
  return flagged;
}
