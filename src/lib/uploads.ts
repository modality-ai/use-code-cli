import { homedir } from "node:os";
import { resolve, sep, join } from "node:path";

export function uploadsDir(): string {
  return join(process.env.HOME || homedir(), ".use-code-cli", "uploads");
}

export function isUploaded(filePath: string): boolean {
  if (!filePath) return false;
  try {
    const uploads = resolve(uploadsDir());
    const target = resolve(filePath);
    return target === uploads || target.startsWith(uploads + sep);
  } catch {
    return false;
  }
}
