import { describe, expect, it } from "vitest";
import { assessReliability, capConfidence, originKey } from "./reliability.js";

describe("reliability", () => {
  it("treats snippets and missing claims as mentions", () => {
    expect(
      assessReliability({
        contentCompleteness: "snippet",
        independentOriginCount: 2,
        supportingCount: 2,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: true,
      }).status,
    ).toBe("mention");
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 1,
        supportingCount: 1,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: false,
      }).status,
    ).toBe("mention");
  });

  it("does not corroborate two hosts of one origin", () => {
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 1,
        supportingCount: 2,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: true,
      }).status,
    ).toBe("single_source");
  });

  it("corroborates independent origins and marks firsthand separately", () => {
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 2,
        supportingCount: 2,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: true,
      }).status,
    ).toBe("corroborated");
    expect(
      assessReliability({
        contentCompleteness: "native_complete",
        independentOriginCount: 1,
        supportingCount: 1,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: true,
        hasValidatedClaim: true,
      }).status,
    ).toBe("primary_confirmed");
  });

  it("records dispute and retraction", () => {
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 2,
        supportingCount: 1,
        contradictingCount: 1,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: true,
      }).status,
    ).toBe("disputed");
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 1,
        supportingCount: 0,
        contradictingCount: 0,
        retractingCount: 1,
        hasTrustedFirsthand: true,
        hasValidatedClaim: true,
      }).status,
    ).toBe("retracted");
  });

  it("caps confidence by reliability and keys origin by actor not hostname", () => {
    expect(capConfidence("single_source", 0.9)).toBe(0.5);
    expect(capConfidence("primary_confirmed", 0.9)).toBe(0.55);
    expect(originKey({ platform: "x", externalId: "42" })).toBe("x:42");
    expect(originKey({ platform: "search", hostname: "News.Example.com" })).toBe(
      "host:news.example.com",
    );
  });

  it("treats a headline mismatch without a second origin as a mention", () => {
    expect(
      assessReliability({
        contentCompleteness: "full_document",
        independentOriginCount: 1,
        supportingCount: 1,
        contradictingCount: 0,
        retractingCount: 0,
        hasTrustedFirsthand: false,
        hasValidatedClaim: true,
        headlineMismatch: true,
      }).status,
    ).toBe("mention");
  });
});
