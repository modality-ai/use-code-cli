import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { staticHandler } from "./static";
import { APP_NAME, REDIRECTS } from "../config/constants";
import { requireAuth } from "../lib/web/auth";
import React from "react";
import { renderToString } from "react-dom/server";
import RootLayout from "../web/layout";

export function routeSegment(name: string): string {
  return /^\[(.*)\]$/.test(name) ? `:${name.slice(1, -1)}` : name;
}

export function pageTitle(route: string, params: Record<string, string> = {}): string {
  if (route === "/") return APP_NAME;
  return route.slice(1).replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => params[key] ?? `:${key}`);
}

const webDir = new URL("../web", import.meta.url).pathname;

// Client bundle URLs to inject for a route dir. client-manifest.json (written by
// tools/build-client.ts) maps route dir -> entry script URLs.
async function clientScriptsFor(relDir: string): Promise<string[]> {
  const distDir = join(import.meta.dir, "..", "..", "public", "dist");
  try {
    const manifest = JSON.parse(await readFile(join(distDir, "client-manifest.json"), "utf8"));
    if (Array.isArray(manifest[relDir])) return manifest[relDir];
  } catch {}
  return [];
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

export function start(options: StartOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? "127.0.0.1";

  const app = new Hono();
  app.use("*", staticHandler);

  // Gate everything under /my behind a valid session.
  app.use("/my/*", async (c, next) => {
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

  // Dynamic API routes (Next.js style: src/web/.../route.ts exporting GET/POST/etc.)
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

  // Dynamic file-based routes
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
      const baseHtml = renderToString(React.createElement(RootLayout, { title, children: pageEl }));
      let html = baseHtml;
      if (clientScript) {
        const script = clientScript(data);
        html = baseHtml.replace("</body>", `${script}</body>`);
      } else {
        // Auto-inject the compiled client bundle(s) for this page (Next.js-like).
        const relDir = filePath.replace(/.*src\/web\//, "").replace(/\/[^\/]+$/, "");
        const scripts = await clientScriptsFor(relDir);
        if (scripts.length) {
          const tags = scripts.map((url) => `<script type="module" src="${url}"></script>`).join("");
          html = baseHtml.replace("</body>", tags + "</body>");
        }
      }
      return c.html(html);
    });
  }

  // Configurable redirects (see src/config/constants.ts REDIRECTS).
  for (const [from, to] of Object.entries(REDIRECTS)) {
    if (from === "/" && pageRoutes.has("/")) continue;
    app.get(from, (c) => c.redirect(to));
  }

  app.notFound((c) => c.json({ success: false, error: "not found" }, 404));

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
    // SSE streams stay open with no data for long stretches; disable Bun's
    // default 10s idle timeout so they aren't cut mid-chunk.
    idleTimeout: 255,
  });
  console.log(`${APP_NAME} server listening on http://${host}:${port}`);
  return server;
}

if (import.meta.main) {
  start();
}