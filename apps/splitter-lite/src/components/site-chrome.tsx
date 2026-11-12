import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { GitHubIcon } from "@/components/github-icon";
import { site } from "@/config/site";

export function SiteHeader() {
  return (
    <header className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
      <Logo />
      <nav className="flex items-center gap-4 text-sm">
        <a href={site.deployedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
          Full app <ArrowUpRight className="size-3.5" />
        </a>
        <a href={site.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline max-sm:hidden">
          <GitHubIcon /> GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-6 text-sm text-muted-foreground sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p>
          Based on{" "}
          <a href={site.repoUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            {site.originalName}
          </a>{" "}
          by {site.author} · MIT. The deployed version stays at{" "}
          <a href={site.deployedUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            {site.deployedUrl.replace("https://", "")}
          </a>
          .
        </p>
        <p>
          AI by{" "}
          <a href={site.modelUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {site.model}
          </a>{" "}
          on{" "}
          <a href={site.nebiusUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Nebius Token Factory
          </a>
        </p>
      </div>
    </footer>
  );
}
