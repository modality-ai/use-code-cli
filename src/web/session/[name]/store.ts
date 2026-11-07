import { createReducer } from "reshow-flux-base";
import type { StoreObject, DispatchFunction } from "reshow-flux-base";

export interface SessionState {
  name: string;
  online: boolean;
  status: string;
}

const initialState: SessionState = { name: "", online: false, status: "idle" };

export function reducer(state: SessionState, action: Partial<SessionState> & { type?: string }): SessionState {
  const { type: _type, ...rest } = action || {};
  return { ...state, ...rest };
}

// Pure mapping helpers used by the session client to render state.
export const STATUS_EMOJI: Record<string, string> = { idle: "💤", busy: "💻", active: "🟢" };
export const onlineEmoji = (online: boolean): string => (online ? "🟢" : "🔴");
export const statusEmoji = (status: string): string => STATUS_EMOJI[status] || "⚪";

export const [sessionStore, sessionDispatch]: [StoreObject<SessionState, Partial<SessionState>>, DispatchFunction<SessionState, Partial<SessionState>>] =
  createReducer(reducer, initialState);
