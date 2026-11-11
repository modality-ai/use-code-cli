import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { start } from "../server";
import { issueSession, SESSION_COOKIE } from "../../lib/web/auth";

const server = start({ host: "127.0.0.1", port: 0 });
const authToken = await issueSession("owner");
const authCookie = `${SESSION_COOKIE}=${authToken}`;
const getHtml = async (path: string) => await (await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { Cookie: authCookie } })).text();

describe("web page SSR + client bundle injection", () => {
  afterAll(() => server.stop());

  it("renders the RootLayout shell without React 18 UMD globals", async () => {
    const html = await getHtml("/help");
    expect(html).toContain('<div id="root"');
    expect(html).toContain('<link rel="stylesheet" href="/dist/style.');
    expect(html).not.toContain("unpkg.com/react@18");
    expect(html).not.toContain("unpkg.com/react-dom@18");
  });

  it("does not inject a client bundle for pages without client code", async () => {
    const html = await getHtml("/help");
    expect(html).not.toContain('<script type="module"');
  });

  it("injects the co-located client component bundle for tunnel", async () => {
    const html = await getHtml("/my/tunnel");
    expect(html).toContain('<script type="module" src="/dist/my/tunnel/TunnelApp.client.js">');
  });

  it("injects the co-located client component bundle for claude-login", async () => {
    const html = await getHtml("/claude-login");
    expect(html).toContain('<script type="module" src="/dist/claude-login/ClaudeLoginApp.client.js">');
  });

  it("injects the co-located client component bundle for sessions", async () => {
    const html = await getHtml("/my/sessions");
    expect(html).toContain('<script type="module" src="/dist/my/sessions/SessionsApp.client.js">');
  });

  it("server-renders initial client component markup + hydration payload for sessions", async () => {
    const html = await getHtml("/my/sessions");
    // Payload assertions use the hydrated-node adjacency ("<div><script>") so
    // quoted mentions of these global names inside transcript text never match.
    expect(html).toContain("<script>window.__REACT_DATA__ = { sessions:"); // consolidated channel only
    expect(html).not.toContain("<div><script>window.__SESSIONS__"); // legacy emission removed (Phase B)
    expect(html).toMatch(/active sessions\.|\/session\//); // empty vs populated markup
  });

  it("client entries contain no manual hydration calls (build shim handles it)", () => {
    const glob = new Bun.Glob("src/web/**/*.client.tsx");
    for (const file of glob.scanSync(".")) {
      const src = require("node:fs").readFileSync(file, "utf8");
      expect(src).not.toMatch(/hydrateClient\s*\(/);
      expect(src).not.toMatch(/hydrateRoot\s*\(/);
    }
  });

  it("emits the consolidated sessionView slice on the session route", async () => {
    const html = await getHtml("/my/session/use-code-cli-51");
    expect(html).toContain('<script>window.__REACT_DATA__ = { sessionView: {"name":"use-code-cli-51"');
    expect(html).not.toContain("<div><script>window.__SESSION_VIEW__"); // legacy emission removed (Phase B)
  });

  it("server-renders initial client component markup + hydration payload for projects", async () => {
    const html = await getHtml("/my/projects");
    expect(html).toContain("<script>window.__REACT_DATA__ = { projects:");
    expect(html).toMatch(/\/my\/project\//);
  });
});
