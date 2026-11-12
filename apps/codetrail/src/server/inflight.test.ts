import { describe, expect, it } from "vitest";
import { asRun, callSignal, cancelRun, CancelledError } from "./cancel";
import { shared } from "./inflight";

/** A stand-in model call: resolves after `ms` unless its signal aborts first. */
function modelCall(ms: number, seen: { aborted: boolean }) {
  return () =>
    new Promise<string>((resolve, reject) => {
      const signal = callSignal()!;
      const t = setTimeout(() => resolve("done"), ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        seen.aborted = true;
        reject(new CancelledError());
      });
    });
}

describe("shared + Stop", () => {
  it("aborts the model call when its only caller stops", async () => {
    const seen = { aborted: false };
    const p = asRun("run-only-one", () => shared("k1", modelCall(200, seen)));
    setTimeout(() => cancelRun("run-only-one"), 10);
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen.aborted).toBe(true);
  });

  it("keeps the call running for another caller still waiting", async () => {
    const seen = { aborted: false };
    const a = asRun("run-a-123", () => shared("k2", modelCall(60, seen)));
    const b = asRun("run-b-123", () => shared("k2", modelCall(60, seen)));
    setTimeout(() => cancelRun("run-a-123"), 10);
    await expect(a).rejects.toBeInstanceOf(CancelledError);
    await expect(b).resolves.toBe("done");
    expect(seen.aborted).toBe(false);
  });

  it("never aborts for a caller that can't press Stop (no run id), e.g. a closed tab or MCP", async () => {
    const seen = { aborted: false };
    const a = asRun("run-c-123", () => shared("k3", modelCall(60, seen)));
    const detached = shared("k3", modelCall(60, seen));
    setTimeout(() => cancelRun("run-c-123"), 10);
    await expect(a).rejects.toBeInstanceOf(CancelledError);
    await expect(detached).resolves.toBe("done");
    expect(seen.aborted).toBe(false);
  });

  it("starts a fresh call for the next person after a stopped one", async () => {
    const first = { aborted: false };
    const p = asRun("run-d-123", () => shared("k4", modelCall(200, first)));
    setTimeout(() => cancelRun("run-d-123"), 5);
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await expect(shared("k4", modelCall(10, { aborted: false }))).resolves.toBe("done");
  });

  it("cancelRun is false for a run that isn't running", () => expect(cancelRun("run-unknown")).toBe(false));
});
