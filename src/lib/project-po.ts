import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProjectPoEntry {
  po?: string;
}

export type ProjectPoMap = Record<string, ProjectPoEntry>;

export function projectsPoPath(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli", "projects.json");
}

export function readProjectPoMap(): ProjectPoMap {
  const p = projectsPoPath();
  try {
    if (!existsSync(p)) return {};
    const raw = readFileSync(p, "utf8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ProjectPoMap;
    }
    return {};
  } catch {
    return {};
  }
}

export function writeProjectPoMap(map: ProjectPoMap): void {
  const p = projectsPoPath();
  mkdirSync(join(process.env.HOME || homedir(), ".use-code-cli"), { recursive: true });
  writeFileSync(p, JSON.stringify(map, null, 2) + "\n", "utf8");
}

export function getProjectPo(dirName: string, cwd: string): string {
  const map = readProjectPoMap();
  const custom = map[dirName]?.po;
  if (custom && custom.trim()) return custom;
  const base = cwd.split("/").filter(Boolean).pop() || dirName;
  return `po-${base}`;
}

export function setProjectPo(dirName: string, po: string): void {
  const map = readProjectPoMap();
  map[dirName] = { ...(map[dirName] || {}), po };
  writeProjectPoMap(map);
}
