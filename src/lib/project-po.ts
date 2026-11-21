import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prettyJsonFile } from "./output/json";
import { withLock } from "./file-lock";

export interface ProjectPoEntry {
  po?: string;
}

export type ProjectPoMap = Record<string, ProjectPoEntry>;

const STATE_DIR = join(process.env.HOME || homedir(), ".use-code-cli");
const PO_FILE = join(STATE_DIR, "projects.json");
const LOCK_FILE = join(STATE_DIR, "projects.lock");


function readMapSync(): ProjectPoMap {
  try {
    if (!existsSync(PO_FILE)) return {};
    const raw = readFileSync(PO_FILE, "utf8");
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
  return PO_FILE;
}

export function readProjectPoMap(): ProjectPoMap {
  return readMapSync();
}

export function writeProjectPoMap(map: ProjectPoMap): void {
  // sync convenience; prefer async setter for locking
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${PO_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, prettyJsonFile(map));
  renameSync(tmp, PO_FILE);
}

export async function setProjectPoAsync(dirName: string, po: string): Promise<void> {
  await withLock(LOCK_FILE, () => {
    const map = readMapSync();
    map[dirName] = { ...(map[dirName] || {}), po };
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${PO_FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, prettyJsonFile(map));
    renameSync(tmp, PO_FILE);
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
