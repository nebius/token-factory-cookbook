// MCP clients look for OAuth metadata under /.well-known before connecting. Codetrail's MCP endpoint needs no sign-in,
// so every /.well-known path answers a plain 404 in JSON, instead of the repo page the catch-all route would render.
export const GET = () => Response.json({ error: "Not found" }, { status: 404 });
