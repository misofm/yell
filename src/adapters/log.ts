// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** The log (Effect's logger: on Cloudflare, Workers Logs): a channel that is always there. */

import { Effect } from "effect";
import type { Channel } from "../Channel.ts";
import type { Level } from "../Notice.ts";

const LOG = { info: Effect.logInfo, warning: Effect.logWarning, critical: Effect.logError } as const;

export const log = (options: { readonly minLevel?: Level; readonly name?: string } = {}): Channel => ({
  name: options.name ?? "log",
  ...(options.minLevel ? { minLevel: options.minLevel } : {}),
  deliver: (notice) => LOG[notice.level](`yell: ${notice.title}`, { source: notice.source, body: notice.body, fields: notice.fields, link: notice.link?.url, at: notice.at }),
});
