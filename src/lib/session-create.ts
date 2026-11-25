import { readSessions, encodeProjectDir, type SessionInfo } from "./sessions";

export type FindExistingSessionReason =
  | "id-found"
  | "name-found"
  | "not-found"
  | "id-conflict";

export interface FindExistingSessionInput {
  projectCwd: string;
  projectDir: string;
  name: string;
  id?: string;
  sessions?: SessionInfo[];
}

export interface FindExistingSessionResult {
  found: boolean;
  session?: SessionInfo;
  reason?: FindExistingSessionReason;
}

export function sameProject(s: SessionInfo, projectCwd: string, projectDir: string): boolean {
  const candidates = [s.cwd, s.latestCwd];
  for (const p of candidates) {
    if (!p) continue;
    if (p === projectCwd) return true;
    if (p === projectDir) return true;
    try {
      if (encodeProjectDir(p) === projectDir) return true;
    } catch {
      // A malformed session cwd cannot be encoded; skip that candidate.
    }
  }
  return false;
}

export async function findExistingSession(
  input: FindExistingSessionInput,
): Promise<FindExistingSessionResult> {
  const { projectCwd, projectDir, name, id } = input;
  const all = input.sessions ?? (await readSessions(true));
  const inProject = all.filter((s) => sameProject(s, projectCwd, projectDir));

  if (id !== undefined && id !== "") {
    const idMatch = inProject.find((s) => s.sessionId === id);
    if (idMatch) {
      return { found: true, session: idMatch, reason: "id-found" };
    }
    const nameMatches = inProject.filter(
      (s) => s.name === name && s.sessionId !== id,
    );
    if (nameMatches.length > 0) {
      return { found: false, reason: "id-conflict" };
    }
    return { found: false, reason: "not-found" };
  }

  const nameMatches = inProject.filter((s) => s.name === name);
  if (nameMatches.length === 0) {
    return { found: false, reason: "not-found" };
  }
  if (nameMatches.length === 1) {
    return { found: true, session: nameMatches[0], reason: "name-found" };
  }
  const sorted = [...nameMatches].sort((a, b) => {
    const ua = a.updatedAt ?? 0;
    const ub = b.updatedAt ?? 0;
    if (ub !== ua) return ub - ua;
    return String(a.sessionId ?? "").localeCompare(String(b.sessionId ?? ""));
  });
  return { found: true, session: sorted[0], reason: "name-found" };
}
