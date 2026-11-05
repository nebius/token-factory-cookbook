/** The wordmark: a sunny tile with a cut-open box, then the name in chunky type. */
export function Logo() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--ink)" }}>
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <rect x="1.25" y="1.25" width="33.5" height="33.5" rx="10" fill="#ffd23f" stroke="#16121f" strokeWidth="2.5" />
        <path d="M11 14 18 10l7 4v8l-7 4-7-4z" fill="#fff" stroke="#16121f" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 18l7-4v8l-7 4z" fill="#ff6fa8" stroke="#16121f" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em" }}>Cutaway</span>
    </span>
  );
}
