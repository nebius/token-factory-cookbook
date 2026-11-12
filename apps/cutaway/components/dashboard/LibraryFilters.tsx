"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/schema/teardown";
import styles from "./dashboard.module.css";

export function LibraryFilters() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "recent";

  const set = (key: string, value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set("q", q);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machines and their parts" aria-label="Search" />
        </div>
        <select className={styles.sort} value={sort} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="studied">Last explored</option>
          <option value="name">A to Z</option>
          <option value="parts">Most parts</option>
        </select>
      </div>
      <div className={styles.chips}>
        <button className={styles.filter} data-on={!category} onClick={() => set("category", "")}>
          Everything
        </button>
        {Object.entries(CATEGORIES).map(([k, label]) => (
          <button key={k} className={styles.filter} data-on={category === k} onClick={() => set("category", category === k ? "" : k)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
