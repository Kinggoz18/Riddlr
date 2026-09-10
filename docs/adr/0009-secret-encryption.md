# AES-256-GCM envelope encryption

Provider credentials are encrypted with AES-256-GCM, a random 96-bit nonce,
and AAD bound to purpose and key version. The master key stays in the
environment or the generated local volume. Secrets are never returned after
submit and never logged.

**Status:** accepted
