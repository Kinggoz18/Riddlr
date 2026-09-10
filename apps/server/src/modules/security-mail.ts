import type { AppConfig } from "@riddlr/config";
import { sendTransactionalEmail } from "./email.js";

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
  config: AppConfig;
  to: string;
  kind: SecurityMailKind;
  text: string;
  logger?: { warn: (obj: unknown, msg: string) => void };
}): Promise<void> {
  try {
    await sendTransactionalEmail({
      config: input.config,
      to: input.to,
      subject: SUBJECTS[input.kind],
      text: input.text,
    });
  } catch (error) {
    input.logger?.warn({ err: error, kind: input.kind }, "security email failed");
  }
}
