# Session idle, absolute expiry, and device cap

Opaque session rows stay in PostgreSQL. Each session records last-seen, idle
timeout, absolute lifetime, and a max-session cap. Settings can revoke a
session. Password change revokes sibling sessions and keeps the current
cookie. JWTs are not the session.

**Status:** accepted
