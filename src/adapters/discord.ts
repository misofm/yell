// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Discord, through a channel webhook (https://discord.com/developers/docs/resources/webhook), as an embed. */

import type { Channel } from "../Channel.ts";
import type { Level, Notice } from "../Notice.ts";
import { clip, defaultFetch, type Fetch, postJson } from "./http.ts";

const COLOR: Record<Level, number> = { info: 0x3b82f6, warning: 0xf59e0b, critical: 0xef4444 };

/** Discord's message for `notice`: one embed; mentions are never parsed. */
export const discordMessage = (notice: Notice) => ({
  allowed_mentions: { parse: [] },
  embeds: [
    {
      title: clip(notice.title, 256),
      ...(notice.body ? { description: clip(notice.body, 4096) } : {}),
      ...(notice.link ? { url: notice.link.url } : {}),
      color: COLOR[notice.level],
      fields: (notice.fields ?? []).slice(0, 25).map((f) => ({ name: clip(f.name, 256), value: clip(f.value, 1024), inline: true })),
      footer: { text: clip(`${notice.level} · ${notice.source}`, 2048) },
      ...(notice.at ? { timestamp: notice.at } : {}),
    },
  ],
});

export const discord = (options: { readonly webhookUrl: string; readonly minLevel?: Level; readonly name?: string; readonly fetch?: Fetch; readonly timeoutMillis?: number }): Channel => {
  const name = options.name ?? "discord";
  return {
    name,
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    deliver: (notice) => postJson(name, options.fetch ?? defaultFetch, options.webhookUrl, discordMessage(notice), options.timeoutMillis ?? 5_000),
  };
};
