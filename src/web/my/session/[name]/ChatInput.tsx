import React from "react";

export interface ChatInputProps {
  chatOpen: boolean;
  chatRef: React.RefObject<HTMLInputElement | null>;
  chatStatus: string;
  sending: boolean;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}

export default function ChatInput({ chatOpen, chatRef, chatStatus, sending, busy, onSend, onStop }: ChatInputProps) {
  return (
    <>
      <div className="flex gap-2 mt-3 w-full" style={{ display: chatOpen ? "flex" : "none" }}>
        <input
          id="chat-input"
          ref={chatRef}
          type="text"
          className="flex-1 min-w-0 w-full px-3 py-2 rounded-sm border border-border bg-surface text-text-primary"
          placeholder="Send a message to this session..."
          aria-label="Send a message to this session"
          onKeyDown={(ev) => {
            if (ev.key === "Enter") onSend();
          }}
        />
        {busy ? (
          <button
            id="chat-pause"
            type="button"
            className="shrink-0 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer"
            onClick={onStop}
            disabled={sending}
            aria-label="Pause the session's active turn"
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
      </div>
      <div id="chat-status" role="status" aria-live="polite" className="text-xs text-text-muted mt-1">{chatStatus}</div>
    </>
  );
}
