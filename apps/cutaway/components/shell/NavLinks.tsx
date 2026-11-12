"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/library", label: "My machines" },
  { href: "/bookmarks", label: "Saved" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className={styles.links}>
      {LINKS.map(({ href, label }) => (
        <Link key={href} href={href} className={styles.link} data-active={href === "/" ? path === "/" : path.startsWith(href)}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
