import React from "react";

export interface ChatInputProps {
  chatOpen: boolean;
  chatRef: React.RefObject<HTMLInputElement | null>;
  chatStatus: string;
  sending: boolean;
  onSend: () => void;
}

export default function ChatInput({ chatOpen, chatRef, chatStatus, sending, onSend }: ChatInputProps) {
  return (
    <>
      <div className="flex gap-2 mt-3 w-full" style={{ display: chatOpen ? "flex" : "none" }}>
        <input
          id="chat-input"
          ref={chatRef}
          type="text"
          className="flex-1 min-w-0 w-full px-3 py-2 rounded-sm border border-border bg-surface text-text-primary"
          placeholder="Send a message to this session..."
          onKeyDown={(ev) => {
            if (ev.key === "Enter") onSend();
          }}
        />
        <button id="chat-send" className="shrink-0 px-3 py-2 rounded-sm border border-border bg-surface text-text-primary cursor-pointer" onClick={onSend} disabled={sending}>Send</button>
      </div>
      <div id="chat-status" className="text-xs text-text-muted mt-1">{chatStatus}</div>
    </>
  );
}