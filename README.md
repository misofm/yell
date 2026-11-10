# yell

**Notifications for services, as an [Effect](https://effect.website) program.**

Describe what happened once, as a `Notice`. Yell sends it to every channel at once: Slack,
Discord, any webhook, your logs, or another Yell running as a notification service. Sending
**never fails and never throws**. A notification must not break the service that sends it, so
you always get back a report of what was delivered, skipped or failed.

```ts
import { Effect } from "effect";
import { discord, log, slack, Yell } from "@misofm/yell";

const yell = Yell.make({
  channels: [
    log(),
    slack({ webhookUrl: env.SLACK_WEBHOOK_URL, minLevel: "warning" }),
    discord({ webhookUrl: env.DISCORD_WEBHOOK_URL, minLevel: "critical" }),
  ],
});

await Effect.runPromise(
  yell.send({
    title: "Stock is low",
    level: "warning",
    source: "inventory-service-production",
    fields: [{ name: "Ready", value: "3 of 20" }],
    link: { label: "Dashboard", url: "https://example.com/inventory" },
  }),
);
// → { _tag: "Sent", delivered: ["log", "slack"], skipped: ["discord"], failed: [] }
```

- **One shape for every channel.** Services describe events and adapters decide how they look, so adding a channel never touches the services that send to it.
- **Safe to call from anywhere.** No exceptions, no rejected promises, no dropped notices. A notice that doesn't fit is trimmed to fit.
- **Quiet about repeats.** The same notice within a cooldown is held back, and the next one says how many were held back.
- **Secure by default.**
  - Webhook URLs never appear in errors or logs.
  - Slack text is escaped and Discord mentions are disabled, so a notice can't ping `@channel` or inject links.
  - Received notices are validated against a schema.
- **Runs anywhere `fetch` does:** Cloudflare Workers (including service bindings), Bun and Node 20+.

## Install

```sh
npm install @misofm/yell effect
```

`effect` (4.1.x) is a peer dependency.

## Notices

A `Notice` is an Effect Schema, so it's typed in code and checked on the wire.

| Field | Required | |
|---|---|---|
| `title` | yes | One line, ≤ 200 characters. |
| `level` | yes | `"info"` (worth knowing), `"warning"` (needs a look soon) or `"critical"` (act now). |
| `source` | yes | What sent it, such as a service and its environment. ≤ 100 characters. |
| `body` | | More detail, plain text. ≤ 4 000 characters. |
| `fields` | | Up to 10 `{ name, value }` facts, shown as a table. |
| `link` | | `{ label, url }`, where to look. `https` only. |
| `key` | | What makes two notices "the same" for throttling. Defaults to `source` + `title`. |
| `at` | | When it happened, as an ISO 8601 string. Defaults to when it is sent. |

The limits are exported as `LIMITS`. `Yell.send` passes every notice through
`normalizeNotice` first. That cuts over-long text with an ellipsis, keeps the first 10 fields,
fills empty values, and drops a non-https link or an invalid time. A notice is never rejected
for a detail.

## Sending

```ts
const report = yield* yell.send(notice); // Effect<Report, never>
```

| `report._tag` | Meaning |
|---|---|
| `"Sent"` | Sent to every channel at or above its `minLevel`. `delivered`, `skipped` and `failed` (`{ channel, reason }[]`) say what happened. |
| `"Throttled"` | A notice with the same key went out less than `cooldown` ago, so this one was held back. |

- **Concurrency:** channels run concurrently. One that fails, times out or crashes never affects the others or the caller.
- **Failures** are also logged as a warning through Effect's logger.

As a layer:

```ts
const program = Effect.gen(function* () {
  const yell = yield* Yell;
  yield* yell.send({ title: "Deployed", level: "info", source: "api-production" });
});

program.pipe(Effect.provide(Yell.layer({ channels: [log()] })));
```

### Options

| Option | Default | |
|---|---|---|
| `channels` | | The channels to send to. |
| `cooldown` | `"10 minutes"` | How long a key stays quiet after a notice goes out. `0` sends every repeat. |
| `now` | `Date.now` | The clock, for tests. |

The throttle is kept in memory, one per `Yell`: per process, or per isolate on Cloudflare. It
remembers the last 1 000 keys.

## Adapters

Every adapter takes `name` (shown in reports) and `minLevel` (the quietest level it sends).
HTTP adapters also take:
- `timeoutMillis`: per attempt, default `5000`;
- `retries`: default `1`;
- `fetch`: a custom fetcher, such as a mock or a service binding.

| Adapter | Sends |
|---|---|
| `log()` | A log line at the notice's level, through Effect's logger (Workers Logs on Cloudflare). It always works, so keep it as a fallback. |
| `slack({ webhookUrl })` | Block Kit through a [Slack incoming webhook](https://api.slack.com/messaging/webhooks): a header, the body, the fields, a link button, and the level and source. |
| `discord({ webhookUrl, username? })` | One embed through a [Discord webhook](https://discord.com/developers/docs/resources/webhook), coloured by level and kept within Discord's 6 000-character embed limit. |
| `webhook({ url, headers? })` | The notice itself, as JSON, to any endpoint. |
| `relay({ binding, url? })` | The notice as JSON to another Yell, such as a notification service behind a Cloudflare service binding. |

**Retries:** an attempt is retried after a `429`, a `5xx`, a timeout or no answer. Yell waits for
`Retry-After` (at most 5 s), or 500 ms if there isn't one. Any other `4xx` fails at once,
because a bad webhook won't get better.

### Writing a channel

A channel is a name, an optional `minLevel`, and a `deliver` function:

```ts
import { Effect } from "effect";
import { type Channel, DeliveryFailed } from "@misofm/yell";

const pager = (client: PagerClient): Channel => ({
  name: "pager",
  minLevel: "critical",
  deliver: (notice) =>
    Effect.tryPromise({
      try: () => client.page(notice.title, notice.body),
      catch: () => new DeliveryFailed({ channel: "pager", reason: "could not be reached" }),
    }),
});
```

Keep credentials out of `reason`. It's meant to be logged and shown.

## A notification service

To give every service in an organisation one place to send notices, run Yell behind an HTTP
endpoint, and point services at it with `relay` or `webhook`. The receiving side is a few
lines: decode the body with `decodeNotice`, then send.

```ts
// Receiving (for example a Cloudflare Worker with no public route, reached by service bindings)
import { Effect } from "effect";
import { decodeNotice, Yell } from "@misofm/yell";

const handle = (request: Request) =>
  Effect.gen(function* () {
    const notice = yield* decodeNotice(yield* Effect.tryPromise(() => request.json()));
    return Response.json(yield* (yield* Yell).send(notice), { status: 202 });
  }).pipe(Effect.catch(() => Effect.succeed(new Response("not a notice", { status: 400 }))));

// Sending, from another Worker bound to it as NOTIFY
const yell = Yell.make({ channels: [log(), relay({ binding: env.NOTIFY })] });
```

Limit the request body size before decoding: a notice is a few KiB at most.

## Security

- **Webhook URLs are credentials.** Keep them in secrets, not code. Adapters never put them in a `DeliveryFailed` reason or a log.
- **Slack:** field text is escaped (`&`, `<`, `>`), so a notice can't mention `@channel` or `@here` or make links. The header and body are plain text.
- **Discord:** `allowed_mentions` is empty, so nothing in a notice pings anyone.
- **Received notices:** decode untrusted JSON with `decodeNotice`. Only `https` links are kept.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

```sh
bun install
bun run check   # typecheck, tests, build
```

The library is plain TypeScript over `effect`, with no other runtime dependencies. Changes are
listed in [CHANGELOG.md](CHANGELOG.md).

## License

[Apache-2.0](LICENSE) © Miso Labs, Inc.
