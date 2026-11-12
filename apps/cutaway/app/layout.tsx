import type { Metadata } from "next";
import { Providers } from "@/components/ui/Providers";
import "./globals.css";


export const metadata: Metadata = {
  title: { default: "Cutaway | Nebius Token Factory", template: "%s · Cutaway | Token Factory" },
  description: "Explore interactive 3D machine illustrations generated with Kimi K3.1 Pro on Nebius Token Factory. Built by Amitesh Anand and Studio1HQ.",
};

// Token Factory starts in dark mode; an explicit visitor preference is preserved.
const themeScript = `try{var t=localStorage.getItem("cutaway-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
