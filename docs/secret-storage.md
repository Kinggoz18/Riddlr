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
  `POST /api/v1/settings/encryption/rotate` (password, plus TOTP if enabled)
  re-encrypts secrets in batches of 50 and increments the version.

The API never returns ciphertext or stored API keys. Settings show the LLM
provider, base URL, and model, plus encryption `configured`, algorithm, and
key version. Email settings show the From address and whether Resend or SMTP
is configured, never the Resend API key. Logs redact secret fields.
