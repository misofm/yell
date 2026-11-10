// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `Yell`: sends a notice to every channel at once. Sending never fails and never throws: a
 * notification must not break the service sending it, so the answer is a report of what was
 * delivered, skipped or failed (and failures are logged).
 *
 * Repeats are throttled: a notice with the same key (`noticeKey`) as one sent less than
 * `cooldown` ago is held back, and the next one that goes out says how many were held back.
 * The throttle lives in memory: one per `Yell` (per Worker isolate, on Cloudflare).
 */

import { Context, Duration, Effect, Layer } from "effect";
import type { Channel } from "./Channel.ts";
import { levelRank, type Notice, noticeKey } from "./Notice.ts";

/** What happened to one notice. */
export type Report =
  /** Held back: a notice with the same key went out less than `cooldown` ago. */
  | { readonly _tag: "Throttled"; readonly key: string }
  | {
      readonly _tag: "Sent";
      /** Channels that took it. */
      readonly delivered: ReadonlyArray<string>;
      /** Channels below their `minLevel`. */
      readonly skipped: ReadonlyArray<string>;
      readonly failed: ReadonlyArray<{ readonly channel: string; readonly reason: string }>;
    };

export interface YellService {
  readonly send: (notice: Notice) => Effect.Effect<Report>;
}

export interface YellOptions {
  readonly channels: ReadonlyArray<Channel>;
  /** How long a key stays quiet after a notice goes out. Default 10 minutes; 0 sends every repeat. */
  readonly cooldown?: Duration.Input;
  /** The clock, in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

/** Keys remembered at most; the oldest are forgotten first. */
const MAX_KEYS = 1_000;

export class Yell extends Context.Service<Yell, YellService>()("@misofm/yell/Yell") {
  static readonly make = (options: YellOptions): YellService => {
    const cooldown = Duration.toMillis(Duration.fromInputUnsafe(options.cooldown ?? Duration.minutes(10)));
    const now = options.now ?? Date.now;
    /** Key → when its last notice went out, and how many were held back since. */
    const recent = new Map<string, { sentAt: number; held: number }>();
    return {
      send: (notice) =>
        Effect.gen(function* () {
          const key = noticeKey(notice);
          const at = now();
          const last = recent.get(key);
          if (last && cooldown > 0 && at - last.sentAt < cooldown) {
            last.held++;
            return { _tag: "Throttled", key } as const;
          }
          recent.delete(key);
          recent.set(key, { sentAt: at, held: 0 });
          if (recent.size > MAX_KEYS) recent.delete(recent.keys().next().value!);
          const outgoing: Notice =
            last && last.held > 0
              ? { ...notice, fields: [...(notice.fields ?? []).slice(0, 9), { name: "Held back", value: `${last.held} more like this since the last one` }] }
              : notice;
          const stamped: Notice = outgoing.at ? outgoing : { ...outgoing, at: new Date(at).toISOString() };

          const due = options.channels.filter((c) => levelRank[notice.level] >= levelRank[c.minLevel ?? "info"]);
          const results = yield* Effect.forEach(
            due,
            (channel) =>
              channel.deliver(stamped).pipe(
                Effect.as({ channel: channel.name, reason: undefined as string | undefined }),
                Effect.catch((e) => Effect.succeed({ channel: channel.name, reason: e.reason as string | undefined })),
                // A channel that throws or dies is a failure too, never the caller's.
                Effect.catchDefect(() => Effect.succeed({ channel: channel.name, reason: "the channel crashed" as string | undefined })),
              ),
            { concurrency: "unbounded" },
          );
          const failed = results.flatMap((r) => (r.reason === undefined ? [] : [{ channel: r.channel, reason: r.reason }]));
          if (failed.length > 0) yield* Effect.logWarning("yell: a notice did not reach every channel", { key, failed });
          return {
            _tag: "Sent",
            delivered: results.filter((r) => r.reason === undefined).map((r) => r.channel),
            skipped: options.channels.filter((c) => !due.includes(c)).map((c) => c.name),
            failed,
          } as const;
        }),
    };
  };

  static readonly layer = (options: YellOptions) => Layer.succeed(Yell, Yell.make(options));
}
