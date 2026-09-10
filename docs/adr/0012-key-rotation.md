# Application key version plus previous master key

Stored credentials and TOTP secrets are AES-256-GCM envelopes bound to purpose
and key version. Operators may set `RIDDLR_ENCRYPTION_MASTER_KEY_PREVIOUS` so
decrypt tries the current master key, then the previous one. Settings rotate
re-encrypts secrets in batches of 50 and increments `instance_settings.key_version`.
The API never returns ciphertext.

**Status:** accepted
