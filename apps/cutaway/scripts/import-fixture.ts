// Turn fixtures/kimi/<name>.design.txt (+ .diagrams.txt) into seed/<name>.json.
// Usage: pnpm seed:fixtures [name] [--provider fixture --model hand-made]
import fs from "node:fs";
import path from "node:path";
import { fromResponses } from "@/lib/kimi/replay";
import { slugify } from "@/lib/slug";
import type { SeedFile } from "@/lib/db/seed";

const args = process.argv.slice(2);
const flag = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const dir = path.join(process.cwd(), "fixtures", "kimi");
const names = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const all = names.length ? names : fs.readdirSync(dir).filter((f) => f.endsWith(".design.txt")).map((f) => f.replace(".design.txt", ""));

fs.mkdirSync(path.join(process.cwd(), "seed"), { recursive: true });
for (const name of all) {
  const design = fs.readFileSync(path.join(dir, `${name}.design.txt`), "utf8");
  const diaFile = path.join(dir, `${name}.diagrams.txt`);
  const { meta, parts, diagrams } = fromResponses(design, fs.existsSync(diaFile) ? fs.readFileSync(diaFile, "utf8") : "");
  const seed: SeedFile = {
    slug: slugify(meta.device.name),
    provider: flag("provider", "fixture"),
    model: flag("model", "hand-made"),
    input: { kind: "text", text: meta.device.name },
    meta,
    parts,
    diagrams,
  };
  const out = path.join(process.cwd(), "seed", `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(seed, null, 1));
  console.log(`${name}: ${parts.length} parts, ${diagrams.length} diagrams -> ${path.relative(process.cwd(), out)}`);
}
