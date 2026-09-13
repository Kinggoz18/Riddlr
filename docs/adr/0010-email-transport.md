# Email transport: Mailpit locally, Resend in production

Password reset and security mail need a transport. Local Compose uses Mailpit
via SMTP. Operators may save a Resend API key in Settings, or set
`RIDDLR_RESEND_API_KEY`. Missing production email degrades reset; it does not
block first-run login. Without email and without authenticator recovery codes,
print a host reset link (`cmd/reset-password`) or wipe the instance.

**Status:** accepted
