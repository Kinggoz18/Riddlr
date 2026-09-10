# Server-side sessions, not JWT as the session

Password change, 2FA, logout-all, and recovery must revoke access immediately.
Opaque session rows in PostgreSQL plus an HttpOnly cookie are the session.
The cookie value is the opaque token HMAC-signed with `RIDDLR_COOKIE_SECRET`.
The token itself is stored only as a SHA-256 hash. JWTs are not used.

**Status:** accepted
