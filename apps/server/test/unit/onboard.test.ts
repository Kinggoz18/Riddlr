import { describe, expect, it } from "vitest";
import {
  type OnboardClient,
  OnboardError,
  type OnboardStatus,
  parseOnboardArgs,
  runOnboard,
} from "../../src/modules/onboard.js";

function client(status: OnboardStatus, calls: string[]): OnboardClient {
  return {
    getStatus: async () => status,
    unlock: async () => {
      calls.push("unlock");
    },
    createAdmin: async () => {
      calls.push("admin");
    },
    skipTotp: async () => {
      calls.push("skip-totp");
    },
    startTotp: async () => ({ otpauth: "otpauth://x", secret: "SECRET" }),
    verifyTotp: async () => ({ recoveryCodes: ["aaaa"] }),
    skipLlm: async () => {
      calls.push("skip-llm");
    },
    saveLlm: async () => {
      calls.push("llm");
    },
    complete: async () => {
      calls.push("complete");
    },
  };
}

const silent = {
  read: async () => "",
  write: () => undefined,
};

describe("onboard CLI", () => {
  it("parses non-interactive flags", () => {
    expect(
      parseOnboardArgs([
        "--non-interactive",
        "--email",
        "ops@example.com",
        "--password-env",
        "RIDDLR_ADMIN_PASSWORD",
        "--skip-totp",
        "--skip-llm",
      ]),
    ).toEqual({
      nonInteractive: true,
      email: "ops@example.com",
      passwordEnv: "RIDDLR_ADMIN_PASSWORD",
      skipTotp: true,
      skipLlm: true,
    });
  });

  it("runs four steps without a setup code when the instance is local", async () => {
    const calls: string[] = [];
    process.env.RIDDLR_ADMIN_PASSWORD = "correct horse battery";
    await runOnboard(
      {
        nonInteractive: true,
        email: "ops@example.com",
        passwordEnv: "RIDDLR_ADMIN_PASSWORD",
        skipTotp: true,
        skipLlm: true,
      },
      client(
        { completed: false, currentStep: "admin", setupAccess: "local", canContinue: true },
        calls,
      ),
      silent,
    );
    expect(calls).toEqual(["admin", "skip-totp", "skip-llm", "complete"]);
  });

  it("ignores a setup code when this host can already continue", async () => {
    const calls: string[] = [];
    await runOnboard(
      {
        nonInteractive: true,
        email: "ops@example.com",
        password: "correct horse battery",
        setupCode: "abcd-ef01-2345-6789-aaaa-bbbb-cccc-dddd",
        skipTotp: true,
        skipLlm: true,
      },
      client(
        { completed: false, currentStep: "admin", setupAccess: "local", canContinue: true },
        calls,
      ),
      silent,
    );
    expect(calls).toEqual(["admin", "skip-totp", "skip-llm", "complete"]);
  });

  it("requires a setup code when the instance says the client cannot continue", async () => {
    const calls: string[] = [];
    await expect(
      runOnboard(
        {
          nonInteractive: true,
          email: "ops@example.com",
          password: "correct horse battery",
          skipTotp: true,
          skipLlm: true,
        },
        client(
          { completed: false, currentStep: "admin", setupAccess: "code", canContinue: false },
          calls,
        ),
        silent,
      ),
    ).rejects.toBeInstanceOf(OnboardError);
    expect(calls).toEqual([]);
  });

  it("unlocks then completes when a setup code is supplied", async () => {
    const calls: string[] = [];
    await runOnboard(
      {
        nonInteractive: true,
        email: "ops@example.com",
        password: "correct horse battery",
        setupCode: "abcd-ef01-2345-6789-aaaa-bbbb-cccc-dddd",
        skipTotp: true,
        skipLlm: true,
      },
      client(
        { completed: false, currentStep: "admin", setupAccess: "code", canContinue: false },
        calls,
      ),
      silent,
    );
    expect(calls).toEqual(["unlock", "admin", "skip-totp", "skip-llm", "complete"]);
  });

  it("refuses non-interactive authenticator enrollment", async () => {
    await expect(
      runOnboard(
        {
          nonInteractive: true,
          email: "ops@example.com",
          password: "correct horse battery",
          skipLlm: true,
        },
        client(
          { completed: false, currentStep: "admin", setupAccess: "local", canContinue: true },
          [],
        ),
        silent,
      ),
    ).rejects.toThrow(/skip authenticator/);
  });

  it("refuses a completed instance", async () => {
    await expect(
      runOnboard(
        { nonInteractive: true, email: "ops@example.com", password: "correct horse battery" },
        client(
          { completed: true, currentStep: "complete", setupAccess: "local", canContinue: true },
          [],
        ),
        silent,
      ),
    ).rejects.toThrow(/already complete/);
  });
});
