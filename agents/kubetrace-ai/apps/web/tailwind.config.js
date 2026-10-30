/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        bg: "hsl(var(--bg))",
        panel: "hsl(var(--panel))",
        raised: "hsl(var(--raised))",
        line: "hsl(var(--line))",
        ink: "hsl(var(--ink))",
        muted: "hsl(var(--muted))",
        faint: "hsl(var(--faint))",
        accent: "hsl(var(--accent))",
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        bad: "hsl(var(--bad))",
        info: "hsl(var(--info))",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".45" } },
      },
      animation: { "fade-in": "fade-in .25s ease-out both", pulse2: "pulse2 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
