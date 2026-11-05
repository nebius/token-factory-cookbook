import type { Metadata } from "next";
import { Bricolage_Grotesque, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/ui/Providers";
import "./globals.css";

// DESIGN.md (toy box): Bricolage Grotesque for chunky headings, Nunito Sans (rounded, very readable) for everything else.
const chunky = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-chunky", weight: ["600", "700", "800"] });
const sans = Nunito_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Cutaway", template: "%s · Cutaway" },
  description: "Show Kimi K3.1 Pro any machine and see every part inside it in 3D, with drawings, a step-by-step teardown and a quiz.",
};

// Applied before paint so the page never flashes the wrong theme. Light is the default.
const themeScript = `try{var t=localStorage.getItem("cutaway-theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chunky.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
