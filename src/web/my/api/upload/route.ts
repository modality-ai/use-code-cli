import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { MAX_UPLOAD_BYTES } from "../../../../config/constants";
import { uploadsDir } from "../../../../lib/uploads";

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("image");
    if (!file || typeof file === "string") {
      return Response.json({ success: false, error: "file required" }, { status: 400 });
    }
    const blob = file as Blob;
    if (blob.size <= 0) {
      return Response.json({ success: false, error: "empty file" }, { status: 400 });
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { success: false, error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` },
        { status: 413 },
      );
    }
    const mime = (file as File).type || "";
    if (mime && !mime.toLowerCase().startsWith("image/")) {
      return Response.json(
        { success: false, error: `unsupported file type: ${mime}` },
        { status: 415 },
      );
    }
    const originalName = (file as File).name || "upload";
    const ext = extname(originalName) || "";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const dir = uploadsDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, unique);
    const buf = Buffer.from(await blob.arrayBuffer());
    writeFileSync(path, buf);
    const url = `/my/api/upload-list/${unique}`;
    return Response.json({ success: true, url, path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
