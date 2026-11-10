# Contributing

Issues and pull requests are welcome.

- `bun install`, then `bun run check` (typecheck, tests, build) must pass.
- New behaviour comes with a test in `test/`.
- A new adapter follows the existing ones:
  - posts through `postJson`;
  - takes `name`, `minLevel` and `PostOptions`;
  - escapes or neutralises anything the destination would interpret (mentions, markup);
  - never puts credentials in a `DeliveryFailed` reason.
- Note user-facing changes in `CHANGELOG.md`.

By contributing, you agree that your contributions are licensed under the Apache-2.0 license.
