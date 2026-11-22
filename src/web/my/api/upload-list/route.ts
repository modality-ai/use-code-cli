import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { uploadsDir } from "../../../../lib/uploads";

export async function GET(request: Request): Promise<Response> {
  try {
    const dir = uploadsDir();
    if (!existsSync(dir)) return Response.json({ success: true, files: [] });
    const names = readdirSync(dir);
    const files = names
      .map((name) => {
        try {
          const st = statSync(join(dir, name));
          if (!st.isFile()) return null;
          return { name, url: `/my/api/upload-list/${encodeURIComponent(name)}`, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return Response.json({ success: true, files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
