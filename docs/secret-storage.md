# Secret storage

Provider credentials and TOTP secrets are encrypted before insert.

- Algorithm: AES-256-GCM
- Random 12-byte nonce
- 16-byte authentication tag
- AAD: purpose and key version (`llm|2`, `totp|<userId>|<version>`)
- Master key: `RIDDLR_ENCRYPTION_MASTER_KEY` (32 bytes, base64)
- Previous key: `RIDDLR_ENCRYPTION_MASTER_KEY_PREVIOUS` (optional). Decrypt
  tries the current key, then the previous key.
- Application key version lives on `instance_settings` and on each envelope.
  `POST /api/v1/settings/encryption/rotate` (password + TOTP) re-encrypts
  secrets in batches of 50 and increments the version.

The API never returns ciphertext contents. Settings show `configured`,
algorithm, and key version only. Logs redact secret fields.
