import React from "react";

export interface ChatInputProps {
  chatOpen: boolean;
  chatRef: React.RefObject<HTMLTextAreaElement | null>;
  chatStatus: string;
  sending: boolean;
  busy: boolean;
  onSend: () => void;
  onPause: () => void;
  onResume: () => void;
}

export default function ChatInput({ chatOpen, chatRef, chatStatus, sending, busy, onSend, onPause, onResume }: ChatInputProps) {
  return (
    <>
      <div className={(chatOpen ? "flex" : "hidden") + " gap-2 w-full"} role="group" aria-label="Chat input">
        <textarea
          id="chat-input"
          ref={chatRef}
          className="flex-1 min-w-0 w-full px-3 py-2 rounded-sm border border-border bg-surface text-text-primary resize-none"
          placeholder="Send a message to this session..."
          aria-label="Send a message to this session"
          aria-describedby="chat-status"
          rows={1}
          onKeyDown={(e) => {
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
        {busy ? (
          <button
            id="chat-pause"
            type="button"
            className="shrink-0 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
            onClick={onPause}
            disabled={sending}
            aria-label="Pause the session (freeze its process)"
          >⏸️</button>
        ) : (
          <button
            id="chat-send"
            type="button"
            className="shrink-0 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
            onClick={onSend}
            disabled={sending}
            aria-label="Send message to the session"
          >▶️</button>
        )}
        <button
          id="chat-resume"
          type="button"
          className="shrink-0 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
          onClick={onResume}
          disabled={sending}
          aria-label="Resume the session (SIGCONT)"
        >▶️</button>
      </div>
      <div id="chat-status" role="status" aria-live="polite" className="text-xs text-text-muted mt-1">{chatStatus}</div>
    </>
  );
}
