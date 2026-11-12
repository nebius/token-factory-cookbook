import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <p className="eyebrow text-muted-foreground">404</p>
        <h1 className="mt-3 text-4xl">Nothing to split here</h1>
        <p className="mt-2 text-muted-foreground">The link may be wrong, or you may not have access to it.</p>
      </div>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
