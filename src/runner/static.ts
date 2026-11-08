import { serveStatic } from "@hono/bun";
import type { MiddlewareHandler } from "hono";
import { statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
export const publicRoot = join(root, "public");

export const cacheFor = (path: string): string => {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path.startsWith("/static/scene/")) return "public, max-age=0, must-revalidate";
  if ((path.startsWith("/dist/") && path.endsWith(".js")) || (path.startsWith("/dist/") && path.endsWith(".css")))
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

/** Pure classifier: should the static file server be skipped for this path?
 *  Extensionless paths and session routes are handled by the dynamic router. */
export const shouldSkipStatic = (path: string): boolean =>
  !path.includes(".") || path.startsWith("/session/") || path.startsWith("/sessions");

export const staticHandler: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    await next();
    return;
  }
  // Page routes and extensionless paths are handled by the dynamic router;
  // don't let serveStatic try (and fail with a status-0 response) on them.
  const path = c.req.path;
  if (shouldSkipStatic(path)) {
    await next();
    return;
  }
  const response = await files(c, next);
  if (!response || !response.status) return;
  c.res = response;
  const etag = c.res.headers.get("etag");
  if (etag && c.req.header("if-none-match") === etag) c.res = new Response(null, { status: 304 });
};