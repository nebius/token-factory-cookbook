// The API has no sign-in: it trusts whoever can reach it, which should only be
// you, on this machine. Two layers keep it that way:
//
// - Network: `pnpm dev` / `pnpm start` listen on 127.0.0.1 only, so other
//   devices can't connect at all. That binding is the real boundary.
// - Browser: this guard refuses requests from other websites (so a page you
//   visit can't send messages, approve actions or add servers through your
//   browser) and requests addressed to any host but localhost (DNS rebinding).
//   Browsers can't forge these headers, but other programs can, so this is not
//   a substitute for the loopback binding or for real sign-in.
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function allowedHosts(): Set<string> {
  const extra = (process.env.OPENDUET_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCAL_HOSTS, ...extra]);
}

function hostname(hostHeader: string | null): string {
  if (!hostHeader) return "";
  // Strip the port, keeping IPv6 brackets intact.
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

const forbidden = (why: string) => NextResponse.json({ error: `Blocked: ${why}` }, { status: 403 });

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!allowedHosts().has(hostname(host).toLowerCase())) {
    return forbidden("OpenDuet only answers on localhost. Set OPENDUET_ALLOWED_HOSTS to serve it on another host name.");
  }

  // Browsers label every request with where it came from. Only same-origin
  // requests (the app itself) and direct navigation are allowed through.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbidden("cross-site request.");

  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden("bad origin.");
    }
    if (originHost !== host) return forbidden("cross-origin request.");
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
