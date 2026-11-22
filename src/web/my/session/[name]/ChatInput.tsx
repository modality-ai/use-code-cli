import React, { useLayoutEffect, useRef, useState } from "react";

const MAX_INPUT_HEIGHT = 160;

export interface ChatInputProps {
  chatOpen: boolean;
  chatRef: React.RefObject<HTMLTextAreaElement | null>;
  chatStatus: string;
  sending: boolean;
  busy: boolean;
  uploadedImage: string | null;
  onImageChange: (path: string | null) => void;
  onSend: () => void;
  onPause: () => void;
  /** Bump after the parent clears the textarea so its height resets too. */
  resetSignal?: number;
}

function ChatInputImpl({ chatOpen, chatRef, chatStatus, sending, busy, uploadedImage, onImageChange, onSend, onPause, resetSignal = 0 }: ChatInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const autoGrow = () => {
    const el = chatRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + "px";
  };

  // Programmatic value clears (after a successful send) do not fire input
  // events, so sync the height whenever the parent signals a reset.
  useLayoutEffect(() => { autoGrow(); }, [resetSignal]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/my/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data?.success && data.path) onImageChange(data.path);
    } catch {
      // ignore upload errors
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className={(chatOpen ? "block" : "hidden") + " w-full"} role="group" aria-label="Chat input">
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-sm transition-colors focus-within:border-accent-collaboration focus-within:ring-2 focus-within:ring-accent-collaboration/25">
          {uploadedImage && (
            <div className="flex items-center gap-2 px-1">
              <img
                src={`/my/api/upload-list/${encodeURIComponent(uploadedImage.split("/").pop() || "")}`}
                alt="Uploaded image preview"
                className="h-12 w-12 object-cover rounded-lg border border-border"
              />
              <button
                type="button"
                className="h-11 w-11 flex items-center justify-center rounded-full text-sm text-text-muted hover:bg-border/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-collaboration focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                onClick={() => onImageChange(null)}
                aria-label="Remove uploaded image"
              >✕</button>
              <span className="text-xs text-text-muted">Image attached</span>
            </div>
          )}
          <div className="flex items-end gap-1">
            <button
              type="button"
              className="shrink-0 h-11 w-11 flex items-center justify-center rounded-full text-text-muted cursor-pointer disabled:opacity-50 hover:bg-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-collaboration focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              onClick={() => fileRef.current?.click()}
              disabled={sending || uploading}
              aria-label={uploading ? "Uploading image" : "Upload image"}
              title="Attach an image"
            >📎</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} tabIndex={-1} />
            <textarea
              id="chat-input"
              ref={chatRef}
              className="peer flex-1 min-w-0 resize-none overflow-y-auto bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none px-2 py-2.5 leading-6"
              style={{ maxHeight: MAX_INPUT_HEIGHT }}
              placeholder="Send a message…"
              aria-label="Send a message to this session"
              aria-describedby="chat-status"
              aria-keyshortcuts="Enter"
              title="Enter to send · Shift+Enter for a new line"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
              rows={1}
              onInput={autoGrow}
              onKeyDown={(e) => {
                // Never hijack Enter while an IME is composing (Japanese,
                // Chinese, Korean input) — that would commit a half-made word.
                if ((e.nativeEvent as any).isComposing) return;
                const isTouchDevice =
                  typeof navigator !== "undefined" &&
                  typeof window !== "undefined" &&
                  (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
                if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
                  e.preventDefault();
                  if (!sending) onSend();
                }
              }}
            />
            <button
              id="chat-send"
              type="button"
              className="shrink-0 h-11 w-11 flex items-center justify-center rounded-full bg-accent-collaboration text-white text-lg cursor-pointer disabled:opacity-50 peer-placeholder-shown:opacity-50 hover:enabled:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-collaboration focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              onClick={onSend}
              disabled={sending}
              aria-label="Send message to the session"
              title="Send message (Enter)"
            >↑</button>
          </div>
        </div>
      </div>
      <div
        id="chat-status"
        role="status"
        aria-live="polite"
        className={(chatOpen ? "flex" : "hidden") + " text-xs text-text-muted mt-1 items-center gap-2 min-h-4"}
      >
        <span>{chatStatus}</span>
        {busy && (
          <button
            id="chat-pause"
            type="button"
            className="shrink-0 min-h-10 px-3 rounded-lg border border-border bg-surface text-text-primary cursor-pointer disabled:opacity-50 hover:bg-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-collaboration focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            onClick={onPause}
            disabled={sending}
            aria-label="Pause the session (freeze its process)"
          >⏸️ Pause</button>
        )}
      </div>
    </>
  );
}

export default React.memo(ChatInputImpl);
