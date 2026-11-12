// One polite live region for the whole app: "Copied", "Answer ready", "Reading: mapping modules". Screen readers
// hear it without focus moving. Created on first use, so pages need no setup.
let region: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string) {
  if (typeof document === "undefined") return;
  if (!region || !document.body.contains(region)) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  // Clear first, so the same message twice is still read.
  region.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (region) region.textContent = message;
  }, 60);
}

/** Copies text and says whether it worked (some browsers block the clipboard). */
export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    announce(`${what}.`);
    return true;
  } catch {
    announce("Copy failed: your browser blocked the clipboard.");
    return false;
  }
}
