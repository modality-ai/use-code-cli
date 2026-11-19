import { describe, expect, it } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { deliver, interrupt } from "../peer";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

describe("interrupt", () => {
  it("throws when the session has no messaging socket path", async () => {
    const s = { pid: 10, sessionId: "s1", cwd: "/tmp" } as any;
    await expect(interrupt(s)).rejects.toThrow("Session 10 has no messaging socket.");
  });

  it("throws when no peer token exists for the pid", async () => {
    const sock = join(tmpdir(), `peer-notoken-${Date.now()}.sock`);
    const s = { pid: 99999999, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
    await expect(interrupt(s)).rejects.toThrow("No peer token found for pid 99999999.");
  });

  it("writes the auth + interrupt frame to the socket and returns the request id", async () => {
    const pid = 99999998;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-ok-${Date.now()}.sock`);
    const received: Buffer[] = [];
    const server = createServer((conn) => {
      conn.on("data", (c) => received.push(c));
      conn.on("end", () => {});
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const requestId = await interrupt(s, "user-cancel");
      expect(typeof requestId).toBe("string");
      expect(requestId.length).toBeGreaterThan(0);

      // Give the client a moment to finish flushing.
      await new Promise((r) => setTimeout(r, 250));

      const text = Buffer.concat(received).toString("utf8");
      const lines = text.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!)).toEqual({ type: "auth", token: "tok-xyz" });
      const frame = JSON.parse(lines[1]!);
      expect(frame.type).toBe("control_request");
      expect(frame.request_id).toBe(requestId);
      expect(frame.request).toEqual({ subtype: "interrupt", reason: "user-cancel" });
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });

  it("defaults the interrupt reason to user-cancel when omitted", async () => {
    const pid = 99999997;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-default-${Date.now()}.sock`);
    const received: Buffer[] = [];
    const server = createServer((conn) => {
      conn.on("data", (c) => received.push(c));
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const requestId = await interrupt(s);
      await new Promise((r) => setTimeout(r, 250));
      const text = Buffer.concat(received).toString("utf8");
      const lines = text.trim().split("\n");
      const frame = JSON.parse(lines[1]!);
      expect(frame.request.subtype).toBe("interrupt");
      expect(frame.request.reason).toBe("user-cancel");
      expect(frame.request_id).toBe(requestId);
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });

  it("throws when the socket refuses the connection", async () => {
    const pid = 99999996;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-refused-${Date.now()}.sock`);
    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      await expect(interrupt(s)).rejects.toThrow();
    } finally {
      await rm(keyPath, { force: true });
    }
  });

  it("forwards a custom reason onto the interrupt frame", async () => {
    const pid = 99999995;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-reason-${Date.now()}.sock`);
    const received: Buffer[] = [];
    const server = createServer((conn) => {
      conn.on("data", (c) => received.push(c));
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const requestId = await interrupt(s, "timeout");
      await new Promise((r) => setTimeout(r, 250));
      const text = Buffer.concat(received).toString("utf8");
      const lines = text.trim().split("\n");
      const frame = JSON.parse(lines[1]!);
      expect(frame.request.reason).toBe("timeout");
      expect(frame.request_id).toBe(requestId);
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });

  it("settles by its absolute deadline even when the peer streams non-stop", async () => {
    const pid = 99999994;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-stream-${Date.now()}.sock`);
    const server = createServer((conn) => {
      // Never stop sending: the 700 ms idle timeout can never fire, so only
      // the absolute deadline can end the exchange.
      const timer = setInterval(() => conn.write("tick\n"), 30);
      conn.on("close", () => clearInterval(timer));
      conn.on("error", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const started = Date.now();
      await Promise.race([
        interrupt(s),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("interrupt() hung past its deadline")), 3000),
        ),
      ]);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });

  it("settles when the peer closes the connection before the frame is sent", async () => {
    const pid = 99999993;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-close-${Date.now()}.sock`);
    const server = createServer((conn) => {
      conn.end(); // close immediately, before the interrupt frame is written
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const requestId = await Promise.race([
        interrupt(s),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("interrupt() hung on early close")), 3000),
        ),
      ]);
      expect(typeof requestId).toBe("string");
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });
});

describe("deliver", () => {
  it("resolves while the peer streams non-stop and never closes, even for a long payload", async () => {
    const pid = 99999991;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-stream-${Date.now()}.sock`);
    const server = createServer((conn) => {
      conn.on("data", () => {}); // read and discard
      // A session relaying output (e.g. tunnel logs) writes continuously and
      // never closes — the old close-wait would hang on exactly this.
      const noise = setInterval(() => conn.write("ping\n"), 20);
      conn.on("close", () => clearInterval(noise));
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      const msgId = await deliver(s, "word ".repeat(200_000), "msg-1");
      expect(msgId).toBe("msg-1");
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  });

  it("rejects with a clear timeout error when the peer never reads a large payload", async () => {
    const pid = 99999990;
    await mkdir(SESSIONS_DIR, { recursive: true });
    const keyPath = join(SESSIONS_DIR, `${pid}.test.key`);
    await writeFile(keyPath, JSON.stringify({ peerToken: "tok-xyz" }), "utf8");

    const sock = join(tmpdir(), `peer-stall-${Date.now()}.sock`);
    const server = createServer(() => {
      // Accept the connection and never read it — the socket buffer fills
      // and the payload cannot be handed over.
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    try {
      const s = { pid, sessionId: "s1", cwd: "/tmp", messagingSocketPath: sock } as any;
      await expect(
        deliver(s, "word ".repeat(200_000), "msg-2"),
      ).rejects.toThrow("Timed out sending to");
    } finally {
      server.close();
      await rm(sock, { force: true });
      await rm(keyPath, { force: true });
    }
  }, 8000);
});

describe("auto-resume on delivery to a stopped session", () => {
  it("sends SIGCONT before interrupting a stopped session", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const s = { pid: 10, sessionId: "s1", cwd: "/tmp", stopped: true } as any;
    await expect(
      interrupt(s, "r", { kill: (pid, signal) => signals.push({ pid, signal }) }),
    ).rejects.toThrow("Session 10 has no messaging socket.");
    expect(signals).toEqual([{ pid: 10, signal: "SIGCONT" }]);
  });

  it("sends SIGCONT before delivering to a stopped session", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const s = { pid: 10, sessionId: "s1", cwd: "/tmp", stopped: true } as any;
    await expect(
      deliver(s, "hi", "m1", { kill: (pid, signal) => signals.push({ pid, signal }) }),
    ).rejects.toThrow("Session 10 has no messaging socket.");
    expect(signals).toEqual([{ pid: 10, signal: "SIGCONT" }]);
  });

  it("does not send SIGCONT when the session is not stopped", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const s = { pid: 10, sessionId: "s1", cwd: "/tmp", stopped: false } as any;
    await expect(
      interrupt(s, "r", { kill: (pid, signal) => signals.push({ pid, signal }) }),
    ).rejects.toThrow("Session 10 has no messaging socket.");
    expect(signals).toEqual([]);
  });
});
