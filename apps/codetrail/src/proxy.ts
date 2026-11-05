// With the default AUTH_MODE=none nobody signs in, so the API should only answer this machine.
//
// - Network: `pnpm dev` / `pnpm start` listen on 127.0.0.1, and the Docker example publishes the port
//   on 127.0.0.1 only.
// - Browser: this guard refuses writes that other websites send through your browser (so a page you
//   visit can't spend your key), and, with AUTH_MODE=none, requests addressed to a host other than
//   localhost or SITE_URL's (DNS rebinding, which would let a page read stored code).
// MCP clients aren't browsers: they send neither header, so they pass.
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostname(hostHeader: string | null): string {
  if (!hostHeader) return "";
  // Strip the port, keeping IPv6 brackets intact.
  const name = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return name.toLowerCase();
}

function siteHostname(): string {
  try {
    return new URL(process.env.SITE_URL ?? "http://localhost:3000").hostname.toLowerCase();
  } catch {
    return "";
  }
}

const forbidden = (why: string) => NextResponse.json({ error: `Blocked: ${why}` }, { status: 403 });

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const site = siteHostname();
  if ((process.env.AUTH_MODE || "none") === "none") {
    const name = hostname(host);
    if (!LOCAL_HOSTS.has(name) && name !== site) {
      return forbidden("with AUTH_MODE=none, Codetrail only answers on localhost or the host in SITE_URL.");
    }
  }

  // Sign-in callbacks come from GitHub; better-auth checks those itself.
  if (WRITES.has(request.method) && !request.nextUrl.pathname.startsWith("/api/auth/")) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return forbidden("cross-site request.");
    const origin = request.headers.get("origin");
    if (origin) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return forbidden("bad origin.");
      }
      if (url.host !== host && url.hostname.toLowerCase() !== site) return forbidden("cross-origin request.");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
