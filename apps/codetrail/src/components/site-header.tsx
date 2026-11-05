import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

export function SiteHeader({ overlay }: { overlay?: boolean }) {
  return (
    <header className={`${overlay ? "relative z-10" : "border-b border-line"} mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6`}>
      <Logo />
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[12px] tracking-[0.12em] uppercase">
        <Link href="/#how" className="text-fg-2 hover:text-fg">
          How it works
        </Link>
        <Link href="/#compare" className="text-fg-2 hover:text-fg">
          Compare
        </Link>
        <Link href="/#faq" className="text-fg-2 hover:text-fg">
          FAQ
        </Link>
        <Link href="/guide" className="text-fg-2 hover:text-fg">
          Guide
        </Link>
        <Link href="/browse" className="text-fg-2 hover:text-fg">
          Browse
        </Link>
        <Link href="/data" className="text-fg-2 hover:text-fg">
          Data
        </Link>
        <ThemeToggle />
        <UserMenu />
      </nav>
    </header>
  );
}
