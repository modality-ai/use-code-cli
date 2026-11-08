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
      <div className="chat-input" style={{ display: chatOpen ? "flex" : "none" }}>
        <input
          id="chat-input"
          ref={chatRef}
          type="text"
          placeholder="Send a message to this session..."
          onKeyDown={(ev) => {
            if (ev.key === "Enter") onSend();
          }}
        />
        <button id="chat-send" onClick={onSend} disabled={sending}>Send</button>
      </div>
      <div id="chat-status" className="text-[12px] text-text-muted mt-1">{chatStatus}</div>
    </>
  );
}