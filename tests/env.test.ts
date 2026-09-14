import { describe, expect, it } from "vitest";
import { getEnvironment } from "@/env";

describe("runtime environment", () => {
  it("rejects a Chrome CDP endpoint that is not loopback", () => {
    expect(() =>
      getEnvironment({ CHROME_CDP_URL: "http://0.0.0.0:9222" })
    ).toThrow(/127\.0\.0\.1/);
  });
});
