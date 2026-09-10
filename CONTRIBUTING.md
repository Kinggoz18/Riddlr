# Contributing to Riddlr

Thank you for contributing. Riddlr is a local-first intelligence engine with an
asset-class-agnostic core. Crypto is the only fully implemented market domain.

## Developer Certificate of Origin

Every commit must include a `Signed-off-by` line:

```
Signed-off-by: Your Name <you@example.com>
```

Git can add this with `git commit -s`.

## Workflow

1. Open an issue or discuss the change.
2. Keep pull requests focused.
3. Do not commit secrets, planning prompts, or agent transcripts.
4. Run `pnpm check` before opening a PR.
5. Add tests at public seams. Do not assert against private internals.

## Architecture constraints

- Core packages (`domain`, `source-adapters`, `llm`, `queue`, `notifications`)
  must not import `@riddlr/domain-crypto`.
- `packages/crypto` is cryptography (AES, Argon2id, TOTP). Market crypto lives in
  `@riddlr/domain-crypto`.
- Coming-soon market domains must not become executable.
- The LLM is read-only. Do not add trading, signing, or secret access.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:browser
```

## License

Contributions are licensed under Apache-2.0.
