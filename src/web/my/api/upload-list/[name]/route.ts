import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { uploadsDir } from "../../../../../lib/uploads";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const name = basename(decodeURIComponent(url.pathname.split("/").pop() || ""));
    if (!name || name.includes("..")) {
      return new Response("not found", { status: 404 });
    }
    const path = join(uploadsDir(), name);
    if (!existsSync(path)) {
      return new Response("not found", { status: 404 });
    }
    const stat = statSync(path);
    if (!stat.isFile()) {
      return new Response("not found", { status: 404 });
    }
    const data = readFileSync(path);
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "application/octet-stream";
    return new Response(data, { status: 200, headers: { "Content-Type": mime, "Content-Length": String(stat.size) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
