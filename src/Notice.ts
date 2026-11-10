// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * A notice: one thing a service wants people to know. The same shape goes to every channel and
 * over the wire (the `relay` adapter posts it as JSON; `decodeNotice` reads it back), so a
 * notification service is just another Yell.
 */

import { Schema } from "effect";

/** How loudly: `info` (worth knowing), `warning` (needs a look soon), `critical` (act now). */
export const Level = Schema.Literals(["info", "warning", "critical"]);
export type Level = typeof Level.Type;

/** Order of the levels, for a channel's `minLevel`. */
export const levelRank: Readonly<Record<Level, number>> = { info: 0, warning: 1, critical: 2 };

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));

export const Notice = Schema.Struct({
  /** One line. */
  title: Text(200),
  level: Level,
  /** What sent it, e.g. a Worker's name: `miso-share-currency-pool-service-testnet`. */
  source: Text(100),
  /** More detail, plain text. */
  body: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4000))),
  /** Facts to show as a table: at most 10. */
  fields: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Text(100), value: Text(500) })).check(Schema.isMaxLength(10))),
  /** Where to look. */
  link: Schema.optionalKey(Schema.Struct({ label: Text(100), url: Schema.String.check(Schema.isPattern(/^https:\/\//)) })),
  /**
   * What makes two notices the same, for throttling repeats (`Yell`'s `cooldown`). Defaults to
   * `source` and `title`.
   */
  key: Schema.optionalKey(Text(200)),
  /** When it happened (ISO 8601); the moment it is sent when absent. */
  at: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Notice" });
export type Notice = typeof Notice.Type;

/** A notice from untrusted JSON (a request body). Fails with: `SchemaError`. */
export const decodeNotice = Schema.decodeUnknownEffect(Notice);

/** The key repeats of `notice` share. */
export const noticeKey = (notice: Notice) => notice.key ?? `${notice.source}\u0000${notice.title}`;
