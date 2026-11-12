import type { Metadata, Viewport } from "next";
import { env, MODEL_LABEL } from "@/env";
import { themeScript } from "@/components/theme-toggle";
import "./globals.css";

const description =
  `Paste any GitHub repo. ${MODEL_LABEL} reads every file at once and gives you an architecture diagram, wiki docs, guided code tours and answers about the code, with every reference checked.`;

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: { default: "Codetrail: understand any GitHub repo, diagram, wiki, tours and Q&A", template: "%s · Codetrail" },
  description,
  applicationName: "Codetrail · Nebius Token Factory",
  keywords: ["code tour", "codebase walkthrough", "architecture diagram", "wiki", "codebase wiki", "repo docs", "AI code docs", "GitHub repo explorer", "DeepSeek", "Kimi", "open model", "DeepWiki alternative", "GitDiagram alternative", "CodeTour", "MCP"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Codetrail", url: "/", title: "Codetrail: understand any GitHub repo, diagram, wiki, tours and Q&A", description },
  twitter: { card: "summary_large_image", title: "Codetrail: understand any GitHub repo, diagram, wiki, tours and Q&A", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#001A2B" },
    { media: "(prefers-color-scheme: light)", color: "#F0F8FF" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        {/* Every page's <main> has id="main". */}
        <a href="#main" className="sr-only z-[100] rounded-md bg-trail px-3 py-2 font-mono text-sm text-[#16171a] focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
