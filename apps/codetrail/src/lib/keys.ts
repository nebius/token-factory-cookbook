// When a page-wide shortcut may act on a key press: never while typing or while a dialog is open, and never for a
// key the focused control uses itself (Space presses a button; arrows move between tabs and radio options).
type Target = { closest(selector: string): unknown } | null;

const TYPING = "input, textarea, select, [contenteditable]";
const USES_SPACE = "button, a, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [tabindex]";
const USES_ARROWS = "[role=tab], [role=radio], [role=slider], [role=listbox]";

export function shortcutAllowed(key: string, target: Target, dialogOpen: boolean): boolean {
  if (dialogOpen || target?.closest(TYPING)) return false;
  if (key === " " && target?.closest(USES_SPACE)) return false;
  if (key.startsWith("Arrow") && target?.closest(USES_ARROWS)) return false;
  return true;
}

const CHAR_KEYS = "codetrail:char-keys";

/** Whether single-character shortcuts (/, ?, T, F) are on. They can be switched off for speech input (WCAG 2.1.4). */
export function charKeysOn(): boolean {
  try {
    return localStorage.getItem(CHAR_KEYS) !== "off";
  } catch {
    return true;
  }
}

export function setCharKeys(on: boolean) {
  try {
    localStorage.setItem(CHAR_KEYS, on ? "on" : "off");
  } catch {
    // No storage: the setting lasts until the page closes.
  }
}
