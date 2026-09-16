import { describe, expect, it } from "vitest";
import {
  computeIdentityTrackRecords,
  effectiveIdentityTrust,
  isCommunitySocialEvidence,
} from "./identity.js";

describe("identity trust and track records", () => {
  it("uses an author policy when present and otherwise the parent channel", () => {
    const policies = new Map([
      ["author", "community" as const],
      ["channel", "official_firsthand" as const],
    ]);
    expect(
      effectiveIdentityTrust({
        identityId: "author",
        parentId: "channel",
        policyByIdentity: policies,
      }),
    ).toBe("community");
    expect(
      effectiveIdentityTrust({
        identityId: "other-author",
        parentId: "channel",
        policyByIdentity: policies,
      }),
    ).toBe("official_firsthand");
  });

  it("treats community X, Discord, and feed rows as social that cannot open events", () => {
    expect(isCommunitySocialEvidence({ sourceFamily: "x", trustTier: "community" })).toBe(true);
    expect(isCommunitySocialEvidence({ sourceFamily: "discord", trustTier: "unknown" })).toBe(true);
    expect(isCommunitySocialEvidence({ sourceFamily: "feed", trustTier: "unknown" })).toBe(true);
    expect(isCommunitySocialEvidence({ sourceFamily: "x", trustTier: "official_firsthand" })).toBe(
      false,
    );
    expect(isCommunitySocialEvidence({ sourceFamily: "feed", trustTier: "reputable_press" })).toBe(
      false,
    );
    expect(isCommunitySocialEvidence({ sourceFamily: "search", trustTier: "community" })).toBe(
      false,
    );
  });

  it("credits a community identity when a primary later corroborates the same claim", () => {
    const records = computeIdentityTrackRecords([
      {
        identityId: "alice",
        claimId: "listing",
        publishedAt: new Date("2026-09-14T10:00:00.000Z"),
        trustTier: "community",
      },
      {
        identityId: "issuer",
        claimId: "listing",
        publishedAt: new Date("2026-09-14T14:00:00.000Z"),
        trustTier: "official_firsthand",
      },
    ]);
    expect(records.get("alice")).toEqual({
      claims: 1,
      laterCorroborated: 1,
      medianLeadHours: 4,
    });
    expect(records.get("issuer")).toEqual({
      claims: 1,
      laterCorroborated: 0,
      medianLeadHours: null,
    });
  });

  it("does not credit an identity that posted after the primary", () => {
    const records = computeIdentityTrackRecords([
      {
        identityId: "issuer",
        claimId: "hack",
        publishedAt: new Date("2026-09-14T10:00:00.000Z"),
        trustTier: "official_firsthand",
      },
      {
        identityId: "alice",
        claimId: "hack",
        publishedAt: new Date("2026-09-14T12:00:00.000Z"),
        trustTier: "community",
      },
    ]);
    expect(records.get("alice")).toEqual({
      claims: 1,
      laterCorroborated: 0,
      medianLeadHours: null,
    });
  });
});
