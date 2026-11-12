import Link from "next/link";
export function Logo({ compact }: { compact?: boolean }) {
 return <Link href="/" className="tf-logo inline-flex items-center gap-3 text-fg" aria-label="Codetrail home"><img src="/brand/token-factory.svg" alt="Nebius Token Factory" width={compact ? 128 : 160} height={22}/>{!compact&&<span className="font-display text-[18px] font-bold">Codetrail</span>}</Link>;
}
