import { serveStatic } from "@hono/bun";
import type { MiddlewareHandler } from "hono";
import { statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
export const publicRoot = join(root, "public");

export const cacheFor = (path: string): string => {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path.startsWith("/static/scene/")) return "public, max-age=0, must-revalidate";
  if (path === "/static/client.js" || (path.startsWith("/styles/") && path.endsWith(".css")))
    return "public, max-age=0, must-revalidate";
  if (path.endsWith(".html") || path === "/" || !path.includes(".")) return "no-cache";
  return "public, max-age=300, must-revalidate";
};

const files: MiddlewareHandler = serveStatic({
  root: publicRoot,
  precompressed: true,
  onFound: (file, c) => {
    const stat = statSync(file);
    const encoding = c.res.headers.get("content-encoding");
    c.header("cache-control", cacheFor(c.req.path));
    c.header("etag", `"${stat.size}-${Math.floor(stat.mtimeMs)}${encoding ? `-${encoding}` : ""}"`);
    c.header("vary", "accept-encoding");
  },
});

export const staticHandler: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    await next();
    return;
  }
  const response = await files(c, next);
  if (!response) return;
  c.res = response;
  const etag = c.res.headers.get("etag");
  if (etag && c.req.header("if-none-match") === etag) c.res = new Response(null, { status: 304 });
};