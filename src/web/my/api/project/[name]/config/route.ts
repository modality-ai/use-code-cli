import { readProjects, findProject, type ProjectInfo } from "../../../../../../lib/projects";
import { readJsonBody } from "../../../../../../lib/web/request";
import { getProjectConfig, setProjectConfigAsync, type ProjectPoEntry } from "../../../../../../lib/project-store";

type UnknownRecord = Record<string, unknown>;

type ValidationResult =
  | { ok: true; config: ProjectPoEntry }
  | { ok: false; error: string };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nameFromRequest(request: Request): string {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("project");
    const seg = parts[idx + 1];
    if (idx >= 0 && seg) return decodeURIComponent(seg);
  } catch {}
  return "";
}

function resolveDir(matches: ProjectInfo[]): string | null {
  if (matches.length !== 1) return null;
  return matches[0]?.dir ?? null;
}

export function validateConfig(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, error: "config must be an object" };
  }
  const cfg: ProjectPoEntry = {};
  if (body.dir !== undefined) {
    if (typeof body.dir !== "string") return { ok: false, error: "dir must be a string" };
    cfg.dir = body.dir;
  }
  if (body.cwd !== undefined) {
    if (typeof body.cwd !== "string") return { ok: false, error: "cwd must be a string" };
    cfg.cwd = body.cwd;
  }
  if (body.sessions !== undefined) {
    if (typeof body.sessions !== "number" || !Number.isFinite(body.sessions)) return { ok: false, error: "sessions must be a number" };
    cfg.sessions = body.sessions;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "number" || !Number.isFinite(body.active)) return { ok: false, error: "active must be a number" };
    cfg.active = body.active;
  }
  if (body.updatedAt !== undefined) {
    if (body.updatedAt !== null && typeof body.updatedAt !== "string" && typeof body.updatedAt !== "number") {
      return { ok: false, error: "updatedAt must be string, number, or null" };
    }
    cfg.updatedAt = body.updatedAt;
  }
  if (body.path !== undefined) {
    if (typeof body.path !== "string") return { ok: false, error: "path must be a string" };
    cfg.path = body.path;
  }
  if (body.agentBin !== undefined) {
    if (typeof body.agentBin !== "string") return { ok: false, error: "agentBin must be a string" };
    cfg.agentBin = body.agentBin;
  }
  if (body.po !== undefined) {
    if (typeof body.po !== "string" || !body.po.trim()) return { ok: false, error: "po must be a non-empty string" };
    cfg.po = body.po;
  }
  if (body.po === undefined) return { ok: false, error: "po is required" };
  return { ok: true, config: cfg };
}

async function handle(request: Request): Promise<Response> {
  const body: unknown = await readJsonBody(request);
  const name = nameFromRequest(request).trim();
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });

  const validation = validateConfig(body);
  if (!validation.ok) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  const projects = await readProjects();
  const matches = findProject(projects, name);
  const dir = resolveDir(matches);
  if (!dir) {
    if (matches.length > 1) return Response.json({ success: false, error: "ambiguous project" }, { status: 400 });
    return Response.json({ success: false, error: "project not found" }, { status: 404 });
  }

  try {
    await setProjectConfigAsync(dir, validation.config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }

  return Response.json({ success: true, data: getProjectConfig(dir) });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  const name = nameFromRequest(request);
  if (!name) return Response.json({ success: false, error: "missing name" }, { status: 400 });
  const projects = await readProjects();
  const matches = findProject(projects, name);
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) {
    const ambiguous = matches.length > 1;
    return Response.json(
      { success: false, error: ambiguous ? "ambiguous project" : "project not found" },
      { status: ambiguous ? 400 : 404 },
    );
  }
  return Response.json({ success: true, data: getProjectConfig(match.dir) });
}
