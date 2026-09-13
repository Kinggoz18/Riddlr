import type { AppConfig } from "@riddlr/config";
import { decryptSecretWithKeys } from "@riddlr/crypto";
import { encryptedSecrets, providerConfigs } from "@riddlr/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { AppContext } from "../context.js";

export type EmailTransportKind = "resend" | "smtp" | "none";

export type EmailTransport = {
  transport: EmailTransportKind;
  resendApiKey?: string;
  smtpUrl?: string;
  emailFrom: string;
};

export type PublicEmailSettings = {
  configured: boolean;
  transport: EmailTransportKind;
  from: string;
};

async function decryptProviderSecret(
  ctx: AppContext,
  secretId: string,
  purpose: string,
): Promise<string | undefined> {
  const secretRows = await ctx.db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, secretId))
    .limit(1);
  const secret = secretRows[0];
  if (!secret) {
    return undefined;
  }
  return decryptSecretWithKeys({
    keys: ctx.masterKeys,
    secret: {
      ciphertext: secret.ciphertext,
      nonce: secret.nonce,
      tag: secret.tag,
      alg: "aes-256-gcm",
      keyVersion: secret.keyVersion,
    },
    purpose,
    aad: `${secret.purpose}|${secret.keyVersion}`,
  });
}

export async function resolveEmailTransport(ctx: AppContext): Promise<EmailTransport> {
  const rows = await ctx.db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.kind, "resend"))
    .limit(1);
  const row = rows[0];
  const fromSetting =
    row && typeof row.settings.from === "string" && row.settings.from.trim()
      ? row.settings.from
      : undefined;
  if (row?.secretId) {
    const key = await decryptProviderSecret(ctx, row.secretId, "resend");
    if (key) {
      return {
        transport: "resend",
        resendApiKey: key,
        emailFrom: fromSetting ?? ctx.config.RIDDLR_EMAIL_FROM,
      };
    }
  }
  if (ctx.config.RIDDLR_RESEND_API_KEY) {
    return {
      transport: "resend",
      resendApiKey: ctx.config.RIDDLR_RESEND_API_KEY,
      emailFrom: ctx.config.RIDDLR_EMAIL_FROM,
    };
  }
  if (ctx.config.RIDDLR_SMTP_URL) {
    return {
      transport: "smtp",
      smtpUrl: ctx.config.RIDDLR_SMTP_URL,
      emailFrom: ctx.config.RIDDLR_EMAIL_FROM,
    };
  }
  return { transport: "none", emailFrom: ctx.config.RIDDLR_EMAIL_FROM };
}

export function publicEmailSettings(transport: EmailTransport): PublicEmailSettings {
  return {
    configured: transport.transport !== "none",
    transport: transport.transport,
    from: transport.emailFrom,
  };
}

export async function sendTransactionalEmail(input: {
  transport: EmailTransport;
  to: string;
  subject: string;
  text: string;
  env?: AppConfig["RIDDLR_ENV"];
  fetchImpl?: typeof fetch;
}): Promise<{ sent: boolean; transport: EmailTransportKind }> {
  if (input.transport.transport === "none") {
    return { sent: false, transport: "none" };
  }
  if (input.env === "test" && !input.fetchImpl) {
    return { sent: true, transport: input.transport.transport };
  }
  if (input.transport.transport === "resend" && input.transport.resendApiKey) {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.transport.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.transport.emailFrom,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend HTTP ${response.status}`);
    }
    return { sent: true, transport: "resend" };
  }
  if (input.transport.transport === "smtp" && input.transport.smtpUrl) {
    const mail = nodemailer.createTransport(input.transport.smtpUrl);
    await mail.sendMail({
      from: input.transport.emailFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { sent: true, transport: "smtp" };
  }
  return { sent: false, transport: "none" };
}
