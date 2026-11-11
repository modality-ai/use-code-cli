import { appendFileSync } from "node:fs";
import { aiTool } from "../../../../../../scripts/index";
import { readJsonBody } from "../../../../../../lib/web/request";
import { spawnPty, registerJob, backgroundLogPath, MAX_LIVE_JOBS, liveJobCount } from "../../../pty/jobs";

interface ProjectEntry {
  cwd?: string;
  dir?: string;
}

// Match a project by exact cwd/dir, then basename, then a trailing-path
// suffix (e.g. "cli" matches "/a/b/use-code-cli"). Pure so the matching
// rules can be tested without hitting aiTool.
export function findProject(projects: ProjectEntry[], name: string): ProjectEntry | undefined {
  const exact = projects.filter((p) => p.cwd === name || p.dir === name);
  const base = exact.length === 0 ? projects.filter((p) => p.cwd?.split("/").pop() === name) : [];
  const suffix = exact.length === 0 && base.length === 0
    ? projects.filter((p) => p.cwd?.endsWith(`/${name}`))
    : [];
  return [...exact, ...base, ...suffix][0];
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  const command = String(body?.command || "").trim();
  const background = Boolean(body?.background);
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });
  if (!command) return Response.json({ success: false, error: "missing command" }, { status: 400 });

  const result = (await aiTool.execute({ command: "projects" })) as { success?: boolean; data?: ProjectEntry[] };
  const projects = Array.isArray(result?.data) ? result.data : [];
  const project = findProject(projects, name);
  if (!project || !project.cwd) return Response.json({ success: false, error: "project not found" }, { status: 404 });
  const cwd = project.cwd;
  if (liveJobCount() >= MAX_LIVE_JOBS) {
    return Response.json({ success: false, error: "too many live jobs; wait for one to finish" }, { status: 429 });
  }

  if (background) {
    // Detached run: terminal output is appended to a log file, request returns immediately.
    const logPath = backgroundLogPath();
    const proc = spawnPty(command, cwd, (data) => {
      try { appendFileSync(logPath, data); } catch { /* log write failure is non-fatal */ }
    });
    proc.terminal.unref();
    const jobId = registerJob(proc, logPath);
    return Response.json({ success: true, background: true, cwd, jobId, pid: proc.pid, log: logPath });
  }

  // Foreground: spawn before the response so the jobId can travel in a header.
  // Data arriving before the stream starts is buffered, then flushed in start().
  const pending: Uint8Array[] = [];
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const proc = spawnPty(command, cwd, (data) => {
    if (controllerRef) {
      // enqueue throws once the stream is closed or the client disconnected.
      try { controllerRef.enqueue(data); } catch { /* stream gone */ }
    } else pending.push(data);
  });
  const jobId = registerJob(proc);

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      for (const data of pending.splice(0)) controller.enqueue(data);
      // The client may disconnect mid-run; enqueue/close throw on a cancelled
      // stream, so guard both exit paths to avoid unhandled rejections.
      const encoder = new TextEncoder();
      const safeEnqueue = (chunk: Uint8Array) => { try { controller.enqueue(chunk); } catch { /* stream gone */ } };
      proc.exited.then((code) => {
        safeEnqueue(encoder.encode(`\n[exit code: ${code ?? 0}]\n`));
        try { controller.close(); } catch { /* stream gone */ }
      }).catch((err) => {
        safeEnqueue(encoder.encode(`\nError: ${err}\n`));
        try { controller.close(); } catch { /* stream gone */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      "X-Cwd": encodeURIComponent(cwd),
      "X-Job-Id": jobId,
    },
  });
}
