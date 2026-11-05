import { describe, expect, it } from "vitest";
import { signatureBlock, signatures } from "./compress";
import { packRepo } from "./pack";
import { findSecrets } from "./secrets";

const file = (path: string, text: string) => ({ path, text, lines: text.split("\n").length });

describe("signatures", () => {
  const src = ["import x from 'y';", "", "export function handle(req) {", "  const a = 1;", "  return a;", "}", "", "class Store {", "  get() {}", "}"].join("\n");
  it("keeps imports and declarations with their real line numbers", () => {
    expect(signatures(src).lines.map(([n]) => n)).toEqual([1, 3, 8]);
    const block = signatureBlock("src/a.ts", src)!;
    expect(block).toContain("=== src/a.ts (10 lines, signatures only) ===");
    expect(block).toContain("3| export function handle(req) {");
    expect(block).toContain("…");
  });
  it("returns null when nothing is a declaration", () => {
    expect(signatureBlock("a.txt", "just\nwords")).toBeNull();
  });
});

describe("packRepo with compression", () => {
  it("sends files that don't fit whole as signatures, in priority order", () => {
    const big = Array.from({ length: 400 }, (_, i) => (i % 20 === 0 ? `export function f${i}() {` : "  doWork();")).join("\n");
    const pack = packRepo([file("README.md", "hi"), file("src/index.ts", "export const a = 1;"), file("src/big.ts", big)], { edges: [], lines: new Map(), entries: ["src/index.ts"] }, 900);
    expect(pack.included.map((f) => f.path)).toEqual(["README.md", "src/index.ts"]);
    expect(pack.compressed.map((f) => f.path)).toEqual(["src/big.ts"]);
    expect(pack.text).toContain("signatures only");
    expect(pack.text).toContain("21| export function f20() {");
  });
});

describe("findSecrets", () => {
  it("flags a file with a private key and leaves normal code alone", async () => {
    const key = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB", "aFDrBz9vFqU4yGJ7x1Y4e1u0sJm6m7a4l0zQfKkXGbS5xq0p7I9P3u1Yb8z2Rc8f", "-----END RSA PRIVATE KEY-----"].join("\n");
    const flagged = await findSecrets([file("deploy/id_rsa.pem", key), file("src/app.ts", "export const port = 3000;")]);
    expect([...flagged]).toEqual(["deploy/id_rsa.pem"]);
  });
});
