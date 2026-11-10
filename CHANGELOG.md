# Changelog

## 0.1.0

First release.

- `Notice`: an Effect Schema with `decodeNotice` for untrusted JSON, `normalizeNotice` and `LIMITS`.
- `Yell`: concurrent fan-out that never fails the caller, per-channel `minLevel`, and a per-key `cooldown` that reports how many repeats were held back.
- Adapters:
  - `log`;
  - `slack`: Block Kit, escaped;
  - `discord`: an embed within Discord's limits, no mentions;
  - `webhook` and `relay`: the notice as JSON.
- HTTP adapters have a timeout per attempt, one retry after a 429, a 5xx or no answer (honouring `Retry-After`), and failure reasons without credentials.
