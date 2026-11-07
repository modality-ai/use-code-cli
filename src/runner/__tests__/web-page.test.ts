import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { start } from "../server";

const server = start({ host: "127.0.0.1", port: 0 });
const getHtml = async (path: string) => await (await fetch(`http://127.0.0.1:${server.port}${path}`)).text();

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
    const html = await getHtml("/tunnel");
    expect(html).toContain('<script type="module" src="/dist/tunnel/TunnelApp.client.js">');
  });

  it("injects the co-located client component bundle for claude-login", async () => {
    const html = await getHtml("/claude-login");
    expect(html).toContain('<script type="module" src="/dist/claude-login/ClaudeLoginApp.client.js">');
  });

  it("injects the co-located client component bundle for sessions", async () => {
    const html = await getHtml("/sessions");
    expect(html).toContain('<script type="module" src="/dist/sessions/SessionsApp.client.js">');
  });

  it("server-renders initial client component markup + hydration payload for sessions", async () => {
    const html = await getHtml("/sessions");
    // Payload assertions use the hydrated-node adjacency ("<div><script>") so
    // quoted mentions of these global names inside transcript text never match.
    expect(html).toContain("<div><script>window.__REACT_DATA__ = { sessions:"); // consolidated channel only
    expect(html).not.toContain("<div><script>window.__SESSIONS__"); // legacy emission removed (Phase B)
    expect(html).toMatch(/active sessions\.|\/session\//); // empty vs populated markup
  });

  it("emits the consolidated sessionView slice on the session route", async () => {
    const html = await getHtml("/session/use-code-cli-51");
    expect(html).toContain('<div><script>window.__REACT_DATA__ = { sessionView: {"name":"use-code-cli-51"');
    expect(html).not.toContain("<div><script>window.__SESSION_VIEW__"); // legacy emission removed (Phase B)
  });
});
