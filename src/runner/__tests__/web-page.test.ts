import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createApp } from "../server";
import * as sessions from "../../lib/sessions";
import * as scripts from "../../scripts/index";
import { issueSession, SESSION_COOKIE } from "../../lib/web/auth";

spyOn(sessions, "readSessions").mockResolvedValue([{ name: "use-code-cli-51", pid: 12345, online: true, sessionId: "sid", status: "active", updatedAt: Date.now() } as any]);
spyOn(scripts.aiTool, "execute").mockImplementation(async (props: any) => {
  if (props?.command === "projects") return { success: true, data: [{ dir: "demo", cwd: "/tmp/demo", sessions: 1, active: 1 }] } as any;
  return { success: true, data: { name: "use-code-cli-51", transcriptPath: null, online: true, status: "active" } } as any;
});

const app = createApp();
const authToken = await issueSession("owner");
const authCookie = `${SESSION_COOKIE}=${authToken}`;
const getHtml = async (path: string) => await (await app.fetch(new Request(`http://localhost${path}`, { headers: { Cookie: authCookie } }))).text();

describe("web page SSR + client bundle injection", () => {
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

  it("injects the co-located client component bundle for schedule", async () => {
    const html = await getHtml("/my/schedule");
    expect(html).toContain('<script type="module" src="/dist/my/schedule/ScheduleApp.client.js">');
    expect(html).toContain("<script>window.__REACT_DATA__ = { schedule:");
  });

  it("renders the standalone schedule add page with its own client bundle", async () => {
    const html = await getHtml("/my/schedule/add?project=foo");
    expect(html).toContain('<script type="module" src="/dist/my/schedule/add/ScheduleAddPage.client.js">');
    expect(html).toContain("Add schedule item");
    expect(html).toMatch(/Project: (?:<!-- -->)?foo/);
  });

  it("server-renders initial client component markup + hydration payload for sessions", async () => {
    const html = await getHtml("/my/sessions");
    expect(html).toContain("<script>window.__REACT_DATA__ = { sessions:");
    expect(html).not.toContain("<div><script>window.__SESSIONS__");
    expect(html).toMatch(/active sessions\.|\/session\//);
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
    expect(html).not.toContain("<div><script>window.__SESSION_VIEW__");
  });

  it("server-renders initial client component markup + hydration payload for projects", async () => {
    const html = await getHtml("/my/projects");
    expect(html).toContain("<script>window.__REACT_DATA__ = { projects:");
    expect(html).toMatch(/\/my\/project\//);
  });

  it("renders the project picker when arriving from the schedule FAB", async () => {
    const html = await getHtml("/my/projects?from=schedule-add");
    expect(html).toContain("Choose a project for a new schedule item");
    expect(html).toContain('href="/my/schedule"');
    expect(html).toContain('id="project-filter"');
  });

  it("renders the project config page shell", async () => {
    const html = await getHtml("/my/project/foo/config");
    expect(html).toContain("Project config");
  });
});
