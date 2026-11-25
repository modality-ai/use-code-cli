import { describe, expect, it } from "bun:test";
import { loadData } from "../page";

describe("schedule add route", () => {
  it("reads the project query param", async () => {
    const data = await loadData({ request: new Request("http://localhost/my/schedule/add?project=my%2Frepo") });
    expect(data.project).toBe("my/repo");
  });

  it("leaves the project unset when the query param is missing", async () => {
    const data = await loadData({ request: new Request("http://localhost/my/schedule/add") });
    expect(data.project).toBeUndefined();
  });
});
