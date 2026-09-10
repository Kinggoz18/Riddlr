# Authentication

No social sign-on.

- Email or username plus Argon2id password
- Opaque PostgreSQL sessions in an HttpOnly cookie
- TOTP (RFC 6238) required during first-run
- Hashed single-use recovery codes; Settings shows remaining count only
- Recovery rotate requires TOTP and returns new codes once
- Password change revokes other sessions and keeps the current session
- Idle timeout (`RIDDLR_SESSION_IDLE_MINUTES`, default 60) and absolute
  lifetime (`RIDDLR_SESSION_ABSOLUTE_HOURS`, default 12)
- Max concurrent sessions (`RIDDLR_MAX_SESSIONS`, default 8)
- Settings lists sessions (no token hash), revokes one, or revokes others
- Password reset via Mailpit locally or Resend in production
- Security mail for new sessions, recovery use, recovery rotate, password
  change, and key rotation (failures do not block the auth path)
- Rate limits on login, 2FA, and reset
- Paginated audit log at `GET /api/v1/audit`

The first user is the administrator. Setup routes close after onboarding.
