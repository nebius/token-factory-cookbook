import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { settings } from "@/lib/model/client";
import { modelName } from "@/lib/model-name";
import "./globals.css";

const inter = localFont({
  variable: "--font-inter",
  src: [
    { path: "./fonts/Inter-Regular.ttf", weight: "400" },
    { path: "./fonts/Inter-Medium.ttf", weight: "500" },
    { path: "./fonts/Inter-SemiBold.ttf", weight: "600" },
  ],
});
const gramatika = localFont({ variable: "--font-gramatika", src: "./fonts/GramatikaBold.otf", weight: "700" });

export const metadata: Metadata = {
  title: "Footnote",
  description: "Turn a report PDF into a spreadsheet model where every number cites its page and line, built by Inkling 2 Small and checked in code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const s = settings();
  return (
    <html lang="en" className={`${inter.variable} ${gramatika.variable}`}>
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <a href="https://tokenfactory.nebius.com/" className="tf-logo" target="_blank" rel="noreferrer">
                <img src="/logo-dark.svg" alt="Nebius Token Factory" width={403} height={55} />
              </a>
              <span className="brand-sep" aria-hidden="true" />
              <Link href="/" className="app-name">
                Footnote
              </Link>
            </div>
            <span className="chip" title={s.model}>
              {modelName(s.model)}
              <span className="chip-provider">{s.provider === "replay" ? " · recorded run" : " on Nebius Token Factory"}</span>
            </span>
          </header>
          <main>{children}</main>
          <footer>
            <span className="faint small">
              Footnote is a <a href="https://tokenfactory.nebius.com/">Nebius Token Factory</a> cookbook recipe. Model:{" "}
              <a href="https://thinkingmachines.ai/model-card/inkling-2-small/">Inkling 2 Small</a> by Thinking Machines.
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
