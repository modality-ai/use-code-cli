import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prettyJsonFile } from "./output/json";
import { withLock } from "./file-lock";

export interface ProjectPoEntry {
  dir?: string;
  cwd?: string;
  sessions?: number;
  active?: number;
  updatedAt?: string | number | null;
  path?: string;
  agentBin?: string;
  po?: string;
}

export type ProjectPoMap = Record<string, ProjectPoEntry>;

function stateDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli");
}

function poFile(): string {
  return join(stateDir(), "projects.json");
}

function lockFile(): string {
  return join(stateDir(), "projects.lock");
}

function readMapSync(): ProjectPoMap {
  try {
    if (!existsSync(poFile())) return {};
    const raw = readFileSync(poFile(), "utf8");
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

export function projectsPoPath(): string {
  return poFile();
}

export function readProjectPoMap(): ProjectPoMap {
  return readMapSync();
}

function writeMap(map: ProjectPoMap): void {
  mkdirSync(stateDir(), { recursive: true });
  const tmp = `${poFile()}.tmp.${process.pid}`;
  writeFileSync(tmp, prettyJsonFile(map));
  renameSync(tmp, poFile());
}

export function writeProjectPoMap(map: ProjectPoMap): void {
  // sync convenience; prefer async setter for locking
  writeMap(map);
}

export async function setProjectPoAsync(dirName: string, po: string): Promise<void> {
  await withLock(lockFile(), () => {
    const map = readMapSync();
    map[dirName] = { ...(map[dirName] || {}), po };
    writeMap(map);
  });
}

/** Pure core: default po name derived from a cwd when no custom override exists. */
export function defaultProjectPo(dirName: string, cwd: string): string {
  const base = cwd.split("/").filter(Boolean).pop() || dirName;
  return `po-${base}`;
}

export function getProjectPo(dirName: string, cwd: string): string {
  const map = readMapSync();
  const custom = map[dirName]?.po;
  if (custom && custom.trim()) return custom;
  return defaultProjectPo(dirName, cwd);
}

export function setProjectPo(dirName: string, po: string): void {
  writeProjectPoMap({ ...readMapSync(), [dirName]: { ...(readMapSync()[dirName] || {}), po } });
}

export function getProjectConfig(dirName: string): ProjectPoEntry {
  const map = readMapSync();
  return map[dirName] || {};
}

export async function setProjectConfigAsync(dirName: string, config: ProjectPoEntry): Promise<void> {
  await withLock(lockFile(), () => {
    const map = readMapSync();
    map[dirName] = { ...(map[dirName] || {}), ...config };
    writeMap(map);
  });
}
