import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "./index.js";

describe("queue contracts", () => {
  it("keeps scan job names stable for idempotent BullMQ job IDs", () => {
    expect(QUEUE_NAMES.scanRun).toBe("riddlr.scan.run");
    expect(QUEUE_NAMES.analyzeEvent).toBe("riddlr.analyze.event");
    expect(QUEUE_NAMES.notifyDeliver).toBe("riddlr.notify.deliver");
  });
});
