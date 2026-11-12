import {
  launchTunnel,
  getSession,
  clearStaleTunnelUrl,
  getTunnelStatus,
  recoverPersistedUrl,
  startTunnel,
  stopTunnel,
  checkCloudflared,
} from "../../../../lib/tunnel";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const streamId = url.searchParams.get("stream");
  if (streamId) {
    const s = getSession(streamId);
    if (!s) return new Response("session not found", { status: 404 });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const c of s.output) controller.enqueue(enc.encode(c));
        if (s.done) {
          controller.enqueue(enc.encode(`\n[process exited with code ${s.exitCode}]\n`));
          controller.close();
          return;
        }
        const listener = (chunk: string) => {
          try { controller.enqueue(enc.encode(chunk)); } catch {}
        };
        s.listeners.add(listener);
        const interval = setInterval(() => {
          if (s.done) {
            clearInterval(interval);
            s.listeners.delete(listener);
            try { controller.close(); } catch {}
          }
        }, 200);
        request.signal.addEventListener("abort", () => {
          clearInterval(interval);
          s.listeners.delete(listener);
          try { controller.close(); } catch {}
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  clearStaleTunnelUrl();
  await recoverPersistedUrl();
  const status = getTunnelStatus();
  const cloud = await checkCloudflared();
  return Response.json({ success: cloud.success, version: cloud.version, url: status.tunnelUrl, autoReconnect: status.autoReconnectEnabled, error: cloud.error });
}

export async function POST(request: Request): Promise<Response> {
  const res = await startTunnel();
  if (!res) {
    return Response.json({ success: false, error: "failed to spawn cloudflared" }, { status: 500 });
  }
  const { id } = res;
  const status = getTunnelStatus();
  return Response.json({ success: true, sessionId: id, projectUrl: `http://127.0.0.1:${process.env.PORT || "3000"}`, url: status.tunnelUrl });
}

export async function DELETE(request: Request): Promise<Response> {
  await stopTunnel();
  return Response.json({ success: true });
}