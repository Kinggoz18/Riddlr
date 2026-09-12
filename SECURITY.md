# Security Policy

## Supported versions

`main` is the only supported branch until the first tagged release.

## Reporting a vulnerability

Do not open a public issue for security reports.

Email **security@riddlr.dev** with:

- a description of the issue
- steps to reproduce
- impact assessment if known
- whether any secrets or user data are involved

You should receive an acknowledgement within 5 business days.

## Local-first secrets

Riddlr encrypts provider credentials with AES-256-GCM before durable storage.
The encryption master key is supplied via `RIDDLR_ENCRYPTION_MASTER_KEY` or
generated into a local volume on first development boot.

By default the dashboard is only at http://127.0.0.1:8080 on the machine that
runs Docker. Opening it from other devices without SSH requires `--public` and
the setup code from that start. Unfinished setup on a URL others can open is
unsafe. Unused setup codes expire after 15 minutes.

Never commit:

- `.env`
- master keys
- API tokens
- recovery codes
- session cookies
- source credentials

## Scope notes

Riddlr is a read-only intelligence engine. It must never collect wallet seed
phrases, private keys, or execute trades. Reports that demonstrate a path from
untrusted source content to privileged actions are in scope.

WhatsApp webhook traffic is untrusted. Verification uses a hashed verify token
and rate limiting. Source HTML is never injected with `dangerouslySetInnerHTML`.
