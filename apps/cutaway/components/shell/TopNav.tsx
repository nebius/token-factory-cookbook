import Link from "next/link";
import { kimiConfig } from "@/lib/kimi/client";
import { GrownUpsMenu } from "./GrownUpsMenu";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./shell.module.css";

export function TopNav() {
  const c = kimiConfig();
  const status = c.provider === "replay" ? "Replaying saved answers (no model calls)" : `Kimi K3.1 Pro on Nebius${c.apiKey ? "" : " · no key yet"}`;
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand} aria-label="Cutaway home">
          <Logo />
        </Link>
        <NavLinks />
        <div className={styles.navRight}>
          <span className={styles.model}>Kimi K3.1 Pro on Nebius</span>
          <ThemeToggle compact />
          <GrownUpsMenu status={status} ok={!!c.apiKey} />
        </div>
      </div>
    </header>
  );
}
