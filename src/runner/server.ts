import { readdirSync, statSync } from "node:fs";
import { Hono } from "hono";
import { staticHandler } from "./static";
import React from "react";
import { renderToString } from "react-dom/server";
import RootLayout from "../web/layout";

export function routeSegment(name: string): string {
  return /^\[(.*)\]$/.test(name) ? `:${name.slice(1, -1)}` : name;
}

const webDir = new URL("../web", import.meta.url).pathname;

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
      const data = await loadData({ params, name: params.name });
      const pageEl = React.createElement(Page, data || {});
      const title = route === "/" ? "use-code-cli" : route.slice(1);
      const baseHtml = renderToString(React.createElement(RootLayout, { title, children: pageEl }));
      let html = baseHtml;
      if (clientScript) {
        const script = clientScript(data);
        html = baseHtml.replace("</body>", `${script}</body>`);
      }
      return c.html(html);
    });
  }

  // Root redirect when no index page
  if (!pageRoutes.has("/")) {
    app.get("/", (c) => c.redirect("/help"));
  }

  app.notFound((c) => c.json({ success: false, error: "not found" }, 404));

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
  console.log(`use-code-cli server listening on http://${host}:${port}`);
  return server;
}

if (import.meta.main) {
  start();
}