import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { staticHandler } from "./static";
import { APP_NAME, REDIRECTS } from "../config/constants";
import { isCsrfSafe, requireAuth } from "../lib/web/auth";
import { initTunnel } from "../lib/tunnel";
import React from "react";
import RootLayout, { renderDocument } from "../web/layout";

export function routeSegment(name: string): string {
  return /^\[(.*)\]$/.test(name) ? `:${name.slice(1, -1)}` : name;
}

// client-manifest.json is keyed by web-relative dir, for both src/ and dist/ paths.
export function relDirFromFilePath(filePath: string): string {
  const rootWeb = /(?:^|\/)(?:src|dist)\/web\//.exec(filePath) ?? /(?:^|\/)web\//.exec(filePath);
  if (!rootWeb) return "";
  const rest = filePath.slice(rootWeb.index + rootWeb[0].length);
  const lastSlash = rest.lastIndexOf("/");
  return lastSlash === -1 ? "" : rest.slice(0, lastSlash);
}

export function pageTitle(route: string, params: Record<string, string> = {}): string {
  if (route === "/") return APP_NAME;
  return route.slice(1).replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => params[key] ?? `:${key}`);
}

const webDir = new URL("../web", import.meta.url).pathname;

// client-manifest.json (written by tools/build-client.ts) maps route dir -> entry script URLs.
// Reload on mtime change so client rebuilds take effect without a server restart.
const manifestPath = join(import.meta.dir, "..", "..", "public", "dist", "client-manifest.json");
let cachedManifest: Record<string, string[]> = {};
let cachedMtime = -1;

async function clientScriptsFor(relDir: string): Promise<string[]> {
  let mtime = -1;
  try {
    mtime = statSync(manifestPath).mtimeMs;
  } catch {}
  if (mtime !== cachedMtime) {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
      cachedManifest = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      cachedManifest = {};
    }
    cachedMtime = mtime;
  }
  const scripts = cachedManifest[relDir];
  return Array.isArray(scripts) ? scripts : [];
}

function discoverFiles(dir: string, base = "", pattern: RegExp): Map<string, string> {
  const routes = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return routes;
  }
  for (const name of entries) {
    const full = `${dir}/${name}`;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const segment = routeSegment(name);
      const sub = discoverFiles(full, base ? `${base}/${segment}` : segment, pattern);
      for (const [r, f] of sub) routes.set(r, f);
      continue;
    }
    if (pattern.test(name)) {
      const route = base === "" ? "/" : `/${base}`;
      routes.set(route, full);
    }
  }
  return routes;
}

const pageRoutes = discoverFiles(webDir, "", /^page\.(tsx|ts|jsx|js)$/);
const apiRoutes = discoverFiles(webDir, "", /^route\.(tsx|ts|jsx|js)$/);

export interface StartOptions {
  port?: number;
  host?: string;
  includeOffline?: boolean;
}

export function createApp(): Hono {
  const app = new Hono();
  app.use("*", staticHandler);

  app.use("/my/*", async (c, next) => {
    // CSRF: browsers always send Origin on state-changing requests, so a
    // cross-site attacker cannot pass this check; reject before auth runs.
    const mutating = c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS";
    if (mutating && !isCsrfSafe(c.req.header("Origin"), c.req.url)) {
      const msg = { success: false, error: "cross-origin request rejected" };
      return c.req.path.startsWith("/my/api") ? c.json(msg, 403) : c.text(msg.error, 403);
    }
    const auth = await requireAuth(c.req.raw);
    if (auth.ok) {
      await next();
      return;
    }
    if (c.req.path.startsWith("/my/api")) {
      return c.json({ success: false, error: "unauthorized" }, 401);
    }
    return c.redirect("/login");
  });

  for (const [route, filePath] of apiRoutes) {
    app.all(route, async (c) => {
      const mod: any = await import(filePath);
      const handler = mod[c.req.method];
      if (typeof handler !== "function") {
        return c.json({ success: false, error: "method not allowed" }, 405);
      }
      const res = await handler(c.req.raw);
      return res instanceof Response ? res : c.json(res);
    });
  }

  for (const [route, filePath] of pageRoutes) {
    app.get(route, async (c) => {
      const mod: any = await import(filePath);
      const Page = mod.default;
      const loadData = typeof mod.loadData === "function" ? mod.loadData : async () => ({});
      const clientScript = typeof mod.clientScript === "function" ? mod.clientScript : null;
      const params = c.req.param() as Record<string, string>;
      const data = await loadData({ params, name: params.name, request: c.req.raw });
      const pageEl = React.createElement(Page, data || {});
      const title = pageTitle(route, params);
      const baseHtml = renderDocument({ title, children: pageEl });
      let html = baseHtml;
      if (clientScript) {
        const script = clientScript(data);
        html = baseHtml.replace("</body>", `${script}</body>`);
      } else {
        const relDir = relDirFromFilePath(filePath);
        const scripts = await clientScriptsFor(relDir);
        if (scripts.length) {
          const tags = scripts.map((url) => `<script type="module" src="${Bun.escapeHTML(url)}"></script>`).join("");
          html = baseHtml.replace("</body>", tags + "</body>");
        }
      }
      return c.html(html);
    });
  }

  // Configurable redirects (see src/config/constants.ts REDIRECTS).
  const registeredWildcards = new Set<string>();
  for (const [from, to] of Object.entries(REDIRECTS)) {
    app.get(from, (c) => c.redirect(to));
    // A directory redirect also covers everything beneath it — but only when the
    // source actually has child routes/pages (so we don't turn a simple
    // redirect like /login -> /passkey into a catch-all /login/* -> /passkey).
    const base = from.replace(/\/+$/, "");
    const hasChildPages = [...pageRoutes.keys()].some((r) => r.startsWith(`${base}/`));
    const wildcard = `${base}/*`;
    if (from !== "/" && !from.includes("*") && hasChildPages && !registeredWildcards.has(wildcard)) {
      registeredWildcards.add(wildcard);
      app.get(wildcard, (c) => c.redirect(to));
    }
  }

  app.notFound((c) => c.json({ success: false, error: "not found" }, 404));
  return app;
}

export function start(options: StartOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? "127.0.0.1";

  const app = createApp();

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
    // SSE streams stay open with no data for long stretches; disable Bun's
    // default 10s idle timeout so they aren't cut mid-chunk.
    idleTimeout: 255,
  });
  console.log(`${APP_NAME} server listening on http://${host}:${port}`);
  void initTunnel(server);
  return server;
}

if (import.meta.main) {
  start({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? "127.0.0.1" });
}