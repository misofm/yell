# yell

Notifications for services, as an [Effect](https://effect.website) program. A service says
what happened once, as a `Notice`; `Yell` sends it to every channel at once through adapters
(Slack, Discord, any webhook, the log, or another Yell). Sending never fails: a notification
must not break the service that sends it.

```ts
import { Effect } from "effect";
import { console, discord, slack, Yell } from "@misofm/yell";

const program = Effect.gen(function* () {
  const yell = yield* Yell;
  yield* yell.send({
    title: "Share currency stock is low",
    level: "warning",
    source: "miso-share-currency-pool-service-testnet",
    fields: [{ name: "Compositions ready", value: "3 of 20" }],
    link: { label: "Status", url: "https://example.com/status" },
  });
});

Effect.runPromise(
  program.pipe(
    Effect.provide(
      Yell.layer({
        channels: [
          console(),
          slack({ webhookUrl: env.SLACK_WEBHOOK_URL, minLevel: "warning" }),
          discord({ webhookUrl: env.DISCORD_WEBHOOK_URL, minLevel: "critical" }),
        ],
        cooldown: "10 minutes",
      }),
    ),
  ),
);
```

## Notices

| Field | |
|---|---|
| `title` | One line, at most 200 characters. |
| `level` | `info`, `warning` or `critical`. |
| `source` | What sent it, such as a Worker's name. |
| `body`, `fields`, `link` | Optional detail: text, up to 10 name/value facts, and an `https` link. |
| `key` | What makes two notices the same, for throttling. Defaults to `source` and `title`. |
| `at` | ISO time. Defaults to when it is sent. |

`Notice` is an Effect Schema, so `decodeNotice` reads one from untrusted JSON, such as a request body.

## Sending

`Yell.send(notice)` answers a `Report`:
- `Sent`, with which channels delivered, skipped (below their `minLevel`) or failed, and why;
- `Throttled`, when a notice with the same key went out less than `cooldown` ago (default 10 minutes).

The next notice for a key that was held back carries a "Held back: N more like this" field. Failures are also logged.

Channels run concurrently, and one that fails, times out or throws never affects the others. The throttle is in memory, one per `Yell`: on Cloudflare that means one per isolate.

## Adapters

| Adapter | Sends |
|---|---|
| `console()` | A log line at the notice's level (Effect's logger; Workers Logs on Cloudflare). |
| `slack({ webhookUrl })` | Block Kit through an incoming webhook. Text is escaped, so a notice can't mention people or inject links. |
| `discord({ webhookUrl })` | One embed through a channel webhook, coloured by level. Mentions are never parsed. |
| `webhook({ url, headers? })` | The notice itself as JSON. |
| `relay({ binding })` | The notice as JSON to another Yell, such as a notification service behind a Cloudflare service binding. |

Each adapter takes `minLevel`, `name`, `timeoutMillis` (default 5 s) and `fetch`. A failed delivery's reason never includes the URL, since webhook URLs are credentials.

To add a channel, implement `Channel`: a `name`, an optional `minLevel`, and `deliver(notice)` returning `Effect<void, DeliveryFailed>`.

## Development

```sh
bun install
bun run check   # typecheck, tests, build
```

Apache-2.0.
