# Email transport: Mailpit locally, Resend in production

Password reset and security mail need a transport. Local Compose uses Mailpit.
Public deployments may set a Resend API key. Missing production email degrades
reset, it does not block first-run login.

**Status:** accepted
