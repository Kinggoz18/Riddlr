import type { AppConfig } from "@riddlr/config";
import nodemailer from "nodemailer";

export async function sendTransactionalEmail(input: {
  config: AppConfig;
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; transport: "resend" | "smtp" | "none" }> {
  if (input.config.RIDDLR_RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.config.RIDDLR_RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.config.RIDDLR_EMAIL_FROM,
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
  if (input.config.RIDDLR_SMTP_URL) {
    const transport = nodemailer.createTransport(input.config.RIDDLR_SMTP_URL);
    await transport.sendMail({
      from: input.config.RIDDLR_EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { sent: true, transport: "smtp" };
  }
  return { sent: false, transport: "none" };
}
