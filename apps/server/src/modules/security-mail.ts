import type { AppContext } from "../context.js";
import { resolveEmailTransport, sendTransactionalEmail } from "./email.js";

export type SecurityMailKind =
  | "password_changed"
  | "password_reset"
  | "recovery_used"
  | "recovery_rotated"
  | "new_session"
  | "keys_rotated";

const SUBJECTS: Record<SecurityMailKind, string> = {
  password_changed: "Your Riddlr password was changed",
  password_reset: "Reset your Riddlr password",
  recovery_used: "A Riddlr recovery code was used",
  recovery_rotated: "Your Riddlr recovery codes were replaced",
  new_session: "A new Riddlr session was opened",
  keys_rotated: "Riddlr encryption keys were rotated",
};

export async function sendSecurityMail(input: {
  ctx: AppContext;
  to: string;
  kind: SecurityMailKind;
  text: string;
}): Promise<{ sent: boolean; transport: "resend" | "smtp" | "none" }> {
  const transport = await resolveEmailTransport(input.ctx);
  try {
    return await sendTransactionalEmail({
      transport,
      to: input.to,
      subject: SUBJECTS[input.kind],
      text: input.text,
      env: input.ctx.config.RIDDLR_ENV,
    });
  } catch (error) {
    input.ctx.logger.warn({ err: error, kind: input.kind }, "security email failed");
    return { sent: false, transport: transport.transport };
  }
}
