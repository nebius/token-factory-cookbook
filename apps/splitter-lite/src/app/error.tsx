"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl">Something went wrong</h1>
      <p className="text-muted-foreground">Please try again. If it keeps happening, refresh the page.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
