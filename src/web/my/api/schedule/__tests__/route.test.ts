import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { aiTool } from "../../../../../scripts/index";
import { GET } from "../route";

let executeSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  executeSpy = spyOn(aiTool, "execute").mockImplementation(async (props: any) => {
    if (props?.command === "sessions") {
      return { success: true, data: [{ sessionId: "s1", name: "alpha" }] };
    }
    return {
      success: true,
      data: {
        crons: [{ id: "c1", cron: "0 8 * * *", recurring: true, prompt: "Morning stretch" }],
        monitors: [],
      },
    };
  });
});

afterEach(() => {
  executeSpy.mockRestore();
});

describe("GET /my/api/schedule", () => {
  it("returns the schedule contract", async () => {
    const response = await GET(new Request("http://localhost/my/api/schedule"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(typeof payload.data.date).toBe("string");
    expect(typeof payload.data.countToday).toBe("number");
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]).toMatchObject({
      id: "c1",
      sessionId: "s1",
      sessionName: "alpha",
      title: "Morning stretch",
      time: "08:00",
      kind: "routine",
      cadence: "Daily",
      days: [0, 1, 2, 3, 4, 5, 6],
      completed: false,
      href: "/my/session/s1",
    });
    expect(payload.data.routines).toHaveLength(1);
  });
});
