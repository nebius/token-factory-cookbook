import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { site } from "@/config/site";
import "./globals.css";

// Self-hosted, SIL Open Font License (see src/fonts/*-OFL.txt): Geist for headings and text, Fragment Mono for labels.
const geist = localFont({ src: "../fonts/Geist-Variable.ttf", variable: "--font-geist", weight: "100 900", display: "swap" });
const mono = localFont({ src: "../fonts/FragmentMono-Regular.ttf", variable: "--font-mono", weight: "400", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
  openGraph: { title: site.name, description: site.description, type: "website" },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#17171c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster
          position="top-center"
          theme="system"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!rounded-lg !border-border !bg-card !text-foreground !shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]",
              description: "!text-muted-foreground",
              closeButton: "!border-border !bg-card !text-foreground",
            },
          }}
        />
      </body>
    </html>
  );
}
