import { describe, expect, it } from "vitest";
import { scanPipelineRunsInline } from "../../src/modules/pipeline.js";

describe("scan pipeline execution path", () => {
  it("runs enrich and cluster inline only in the test environment", () => {
    expect(scanPipelineRunsInline("test")).toBe(true);
    expect(scanPipelineRunsInline("development")).toBe(false);
    expect(scanPipelineRunsInline("production")).toBe(false);
  });
});
