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

/** The limits a notice is held to: what every adapter can show without being refused. */
export const LIMITS = { title: 200, source: 100, body: 4000, fields: 10, fieldName: 100, fieldValue: 500, linkLabel: 100, url: 2000, key: 200 } as const;

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const isIsoTime = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

export const Notice = Schema.Struct({
  /** One line. */
  title: Text(LIMITS.title),
  level: Level,
  /** What sent it, e.g. a Worker's name: `miso-share-currency-pool-service-testnet`. */
  source: Text(LIMITS.source),
  /** More detail, plain text. */
  body: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(LIMITS.body))),
  /** Facts to show as a table: at most 10. */
  fields: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Text(LIMITS.fieldName), value: Text(LIMITS.fieldValue) })).check(Schema.isMaxLength(LIMITS.fields))),
  /** Where to look. */
  link: Schema.optionalKey(Schema.Struct({ label: Text(LIMITS.linkLabel), url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/), Schema.isMaxLength(LIMITS.url)) })),
  /**
   * What makes two notices the same, for throttling repeats (`Yell`'s `cooldown`). Defaults to
   * `source` and `title`.
   */
  key: Schema.optionalKey(Text(LIMITS.key)),
  /** When it happened (ISO 8601, e.g. `new Date().toISOString()`); the moment it is sent when absent. */
  at: Schema.optionalKey(Schema.String.check(Schema.makeFilter(isIsoTime, { description: "an ISO 8601 time" }))),
}).annotate({ identifier: "Notice" });
export type Notice = typeof Notice.Type;

/** A notice from untrusted JSON (a request body). Fails with: `SchemaError`. */
export const decodeNotice = Schema.decodeUnknownEffect(Notice);

const cut = (text: string, max: number) => ([...text].length <= max ? text : `${[...text].slice(0, max - 1).join("")}…`);
const nonEmpty = (text: string, fallback: string) => (text.trim() === "" ? fallback : text);

/**
 * `notice` made to fit `Notice`, so it is never lost to a detail: text cut to its limit (with
 * an ellipsis), at most 10 fields, empty values filled in, and a `link` that isn't an https
 * URL or an `at` that isn't an ISO time dropped. `Yell.send` applies it to every notice. Pure.
 */
export const normalizeNotice = (notice: Notice): Notice => {
  const link = notice.link && /^https:\/\/\S+$/.test(notice.link.url) && notice.link.url.length <= LIMITS.url ? notice.link : undefined;
  return {
    title: cut(nonEmpty(notice.title, "(untitled)"), LIMITS.title),
    level: notice.level,
    source: cut(nonEmpty(notice.source, "(unknown)"), LIMITS.source),
    ...(notice.body !== undefined && notice.body !== "" ? { body: cut(notice.body, LIMITS.body) } : {}),
    ...(notice.fields?.length
      ? { fields: notice.fields.slice(0, LIMITS.fields).map((f) => ({ name: cut(nonEmpty(f.name, "-"), LIMITS.fieldName), value: cut(nonEmpty(f.value, "-"), LIMITS.fieldValue) })) }
      : {}),
    ...(link ? { link: { label: cut(nonEmpty(link.label, "Open"), LIMITS.linkLabel), url: link.url } } : {}),
    ...(notice.key ? { key: cut(notice.key, LIMITS.key) } : {}),
    ...(notice.at && isIsoTime(notice.at) ? { at: notice.at } : {}),
  };
};

/** The key repeats of `notice` share. */
export const noticeKey = (notice: Notice) => notice.key ?? `${notice.source}\u0000${notice.title}`;
