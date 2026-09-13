import { describe, expect, it, vi } from "vitest";
import { publicEmailSettings, sendTransactionalEmail } from "../../src/modules/email.js";

describe("transactional email", () => {
  it("does not send when no transport is configured", async () => {
    const result = await sendTransactionalEmail({
      transport: { transport: "none", emailFrom: "Riddlr <noreply@localhost>" },
      to: "ops@example.com",
      subject: "Reset",
      text: "link",
    });
    expect(result).toEqual({ sent: false, transport: "none" });
  });

  it("posts to Resend and omits the API key from public settings", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const transport = {
      transport: "resend" as const,
      resendApiKey: "re_test_secret_must_not_appear",
      emailFrom: "Riddlr <alerts@example.com>",
    };
    const result = await sendTransactionalEmail({
      transport,
      to: "ops@example.com",
      subject: "Reset your Riddlr password",
      text: "Use this link",
      fetchImpl,
    });
    expect(result).toEqual({ sent: true, transport: "resend" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_secret_must_not_appear");
    const publicSettings = publicEmailSettings(transport);
    expect(publicSettings).toEqual({
      configured: true,
      transport: "resend",
      from: "Riddlr <alerts@example.com>",
    });
    expect(JSON.stringify(publicSettings)).not.toContain("re_test");
  });
});
