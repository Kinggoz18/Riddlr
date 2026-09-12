import { describe, expect, it } from "vitest";
import {
  dashboardPublish,
  formatSetupCode,
  isLoopbackAddress,
  needsSetupCode,
  normalizeSetupCode,
  publishRequiresSetupCode,
  SETUP_CODE_BYTES,
  SETUP_CODE_HEX_LENGTH,
  SETUP_CODE_TTL_MINUTES,
  SETUP_CODE_TTL_MS,
  setupAccessView,
  setupCanContinue,
  setupCodeIsExpired,
  sshTunnelCommand,
} from "./setup-access.js";

describe("setup access helpers", () => {
  it("maps operator mode to the public status view", () => {
    expect(setupAccessView("loopback")).toBe("local");
    expect(setupAccessView("public")).toBe("code");
  });

  it("normalizes typed setup codes without keeping punctuation", () => {
    expect(SETUP_CODE_BYTES).toBe(16);
    expect(SETUP_CODE_HEX_LENGTH).toBe(32);
    expect(normalizeSetupCode("Ab12-CD34-ef56")).toBe("ab12cd34ef56");
    expect(formatSetupCode("ab12cd34ef56")).toBe("ab12-cd34-ef56");
  });

  it("treats the 127/8 block and IPv6 localhost as loopback", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.4")).toBe(false);
    expect(isLoopbackAddress("203.0.113.8")).toBe(false);
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
  });

  it("prints an SSH tunnel a laptop can paste", () => {
    expect(sshTunnelCommand({ user: "ops", host: "vps.example.net" })).toBe(
      "ssh -N -L 8080:127.0.0.1:8080 ops@vps.example.net",
    );
  });

  it("fails closed when Compose publish is not this computer", () => {
    expect(publishRequiresSetupCode("127.0.0.1:8080")).toBe(false);
    expect(publishRequiresSetupCode("localhost:8080")).toBe(false);
    expect(publishRequiresSetupCode("[::1]:8080")).toBe(false);
    expect(publishRequiresSetupCode("0.0.0.0:8080")).toBe(true);
    expect(publishRequiresSetupCode("8080")).toBe(true);
  });

  it("keeps the wizard open on loopback and blocks public clients without proof", () => {
    expect(
      setupCanContinue({
        completed: false,
        access: "local",
        fromLoopback: false,
        hasSetupProof: false,
      }),
    ).toBe(true);
    expect(
      setupCanContinue({
        completed: false,
        access: "code",
        fromLoopback: false,
        hasSetupProof: false,
      }),
    ).toBe(false);
    expect(
      setupCanContinue({
        completed: false,
        access: "code",
        fromLoopback: true,
        hasSetupProof: false,
      }),
    ).toBe(true);
    expect(
      setupCanContinue({
        completed: false,
        access: "code",
        fromLoopback: false,
        hasSetupProof: true,
      }),
    ).toBe(true);
    expect(needsSetupCode({ setupAccess: "code", canContinue: false })).toBe(true);
    expect(needsSetupCode({ setupAccess: "local", canContinue: true })).toBe(false);
    expect(dashboardPublish("loopback")).toBe("127.0.0.1:8080");
    expect(dashboardPublish("public")).toBe("0.0.0.0:8080");
  });

  it("expires an unclaimed setup code after 15 minutes", () => {
    expect(SETUP_CODE_TTL_MINUTES).toBe(15);
    expect(SETUP_CODE_TTL_MS).toBe(15 * 60 * 1000);
    expect(setupCodeIsExpired(new Date(Date.now() - 14 * 60 * 1000).toISOString())).toBe(false);
    expect(setupCodeIsExpired(new Date(Date.now() - 16 * 60 * 1000).toISOString())).toBe(true);
    expect(setupCodeIsExpired("not-a-date")).toBe(true);
  });
});
