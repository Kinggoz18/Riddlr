import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "./index.js";

describe("queue contracts", () => {
  it("keeps scan job names stable for idempotent BullMQ job IDs", () => {
    expect(QUEUE_NAMES.scanRun).toBe("riddlr.scan.run");
    expect(QUEUE_NAMES.ingestSource).toBe("riddlr.ingest.source");
    expect(QUEUE_NAMES.enrichEvidence).toBe("riddlr.enrich.evidence");
    expect(QUEUE_NAMES.understandEvidence).toBe("riddlr.understand.evidence");
    expect(QUEUE_NAMES.clusterEvents).toBe("riddlr.cluster.events");
    expect(QUEUE_NAMES.analyzeEvent).toBe("riddlr.analyze.event");
    expect(QUEUE_NAMES.notifyDeliver).toBe("riddlr.notify.deliver");
    expect(QUEUE_NAMES.observePoll).toBe("riddlr.observe.poll");
    expect(QUEUE_NAMES.recordOutcomes).toBe("riddlr.outcomes.record");
  });
});
