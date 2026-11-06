// Shared DOM element IDs for the Claude Code login page.
// Single source of truth — both the React view (page.tsx) and the
// client-side enhancement script (client.ts) reference these constants
// so that a rename propagates to both sides at compile time.
export const CLAUDE_STATUS = "claude-status";
export const LOGIN_MODE = "login-mode";
export const LOGIN_BTN = "login-btn";
export const STATUS_BTN = "status-btn";
export const CODE_BOX = "code-box";
export const CODE_INPUT = "code-input";
export const SEND_CODE_BTN = "send-code-btn";
export const LOGIN_OUTPUT = "login-output";
