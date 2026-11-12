import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenDuet",
  description: "A chat app for your own team of AI bots, on open-source models.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
  colorScheme: "light dark",
};

// Runs before first paint, so a saved theme never flashes the default one.
// Keep in sync with src/lib/client/theme.ts.
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("openduet:theme")||"system";var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions often add attributes to <html> and <body> before React
    // loads; this keeps that from being reported as a hydration mismatch.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
