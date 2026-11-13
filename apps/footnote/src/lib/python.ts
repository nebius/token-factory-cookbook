import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// run_python: the model's calculator. Code runs in a fresh temp folder with `python3 -I`, a time limit
// and an output cap. On macOS, sandbox-exec blocks the network, writes outside that folder, and reading
// files in your home folder other than Python's own install, so a prompt-injected PDF can't make it read
// .env or ~/.ssh. Elsewhere there is no comparable sandbox here (`unshare -rn` removes only the network,
// not file access), so the tool is off unless FOOTNOTE_PYTHON=unsandboxed is set, for example in a container.

type PythonResult = { ok: boolean; stdout: string; stderr: string; ms: number; timedOut: boolean; sandbox: string };

const LIMIT_MS = 20_000;
const MAX_OUT = 12_000;

type Runner = { cmd: string; args: (dir: string, script: string) => string[]; name: string };

let runner: Runner | null | undefined;

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function profile(dir: string, readable: string[]) {
  const q = (p: string) => `"${p.replace(/["\\]/g, "")}"`;
  const d = q(dir);
  return `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath ${d}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))
(deny file-read-data (subpath ${q(os.homedir())}))
(allow file-read-data (subpath ${d})${readable.map((p) => ` (subpath ${q(p)})`).join("")})`;
}

/** Where this Python lives (its prefixes and executable folder), so it can still load its own modules
 * when they sit in the home folder (pyenv, uv, a virtualenv). */
async function pythonDirs(python: string): Promise<string[]> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(python, ["-I", "-c", "import os, sys; print(sys.prefix); print(sys.base_prefix); print(os.path.dirname(os.path.realpath(sys.executable)))"], { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.on("error", () => resolve([]));
    p.on("exit", () => resolve([...new Set(out.split("\n").map((l) => l.trim()).filter((l) => path.isAbsolute(l)))]));
  });
}

async function pickRunner(): Promise<Runner | null> {
  const python = process.env.FOOTNOTE_PYTHON_BIN || "python3";
  if (process.platform === "darwin" && (await exists("/usr/bin/sandbox-exec"))) {
    const readable = await pythonDirs(python);
    return { name: "sandbox-exec (no network, writes only to its temp folder, no reading your home folder)", cmd: "/usr/bin/sandbox-exec", args: (dir, script) => ["-p", profile(dir, readable), python, "-I", script] };
  }
  if (process.env.FOOTNOTE_PYTHON === "unsandboxed") return { name: "unsandboxed (FOOTNOTE_PYTHON=unsandboxed)", cmd: python, args: (_dir, script) => ["-I", script] };
  return null;
}

export async function pythonAvailable(): Promise<string | null> {
  if (runner === undefined) runner = await pickRunner();
  return runner?.name ?? null;
}

export async function runPython(code: string): Promise<PythonResult> {
  if (runner === undefined) runner = await pickRunner();
  if (!runner) return { ok: false, stdout: "", stderr: "Python is turned off: no sandbox is available on this machine (see README).", ms: 0, timedOut: false, sandbox: "none" };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "footnote-py-"));
  const real = await fs.realpath(dir);
  const script = path.join(real, "main.py");
  await fs.writeFile(script, code);
  const t0 = Date.now();
  const r = runner;
  try {
    return await new Promise<PythonResult>((resolve) => {
      const p = spawn(/*turbopackIgnore: true*/ r.cmd, r.args(real, script), {
        cwd: real,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: real, TMPDIR: real, MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1" } as unknown as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = (s: string, d: Buffer) => (s.length < MAX_OUT ? s + d.toString() : s);
      p.stdout.on("data", (d: Buffer) => (stdout = cap(stdout, d)));
      p.stderr.on("data", (d: Buffer) => (stderr = cap(stderr, d)));
      const timer = setTimeout(() => {
        timedOut = true;
        p.kill("SIGKILL");
      }, LIMIT_MS);
      p.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr: String(e), ms: Date.now() - t0, timedOut, sandbox: r.name });
      });
      p.on("exit", (code) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0 && !timedOut,
          stdout: stdout.slice(0, MAX_OUT),
          stderr: (timedOut ? `Stopped after ${LIMIT_MS / 1000} s.\n` : "") + stderr.slice(-MAX_OUT).replaceAll(real, "."),
          ms: Date.now() - t0,
          timedOut,
          sandbox: r.name,
        });
      });
    });
  } finally {
    await fs.rm(real, { recursive: true, force: true });
  }
}
