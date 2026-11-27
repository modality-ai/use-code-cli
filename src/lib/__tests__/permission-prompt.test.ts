import { describe, expect, it } from "bun:test";
import { isPermissionPromptWaiting } from "../permission-prompt";

describe("isPermissionPromptWaiting", () => {
  it("recognizes only waiting sessions whose reason mentions permission", () => {
    expect([
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "permission prompt" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "Permission requested" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "awaiting permission" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "user input" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "permissions revoked" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: "waiting for permission-mode change" }),
      isPermissionPromptWaiting({ status: "waiting", waitingFor: null }),
      isPermissionPromptWaiting({ status: "busy", waitingFor: "permission prompt" }),
      isPermissionPromptWaiting({ status: null, waitingFor: "permission prompt" }),
    ]).toEqual([true, true, true, false, false, false, false, false, false]);
  });
});
