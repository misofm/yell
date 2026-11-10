// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Discord, through a channel webhook (https://discord.com/developers/docs/resources/webhook), as an embed. */

import type { Channel } from "../Channel.ts";
import type { Level, Notice } from "../Notice.ts";
import { clip, defaultFetch, type Fetch, type PostOptions, postJson } from "./http.ts";

const COLOR: Record<Level, number> = { info: 0x3b82f6, warning: 0xf59e0b, critical: 0xef4444 };

/** Discord refuses an embed whose title, description, fields and footer add up to more. */
const EMBED_BUDGET = 6_000;
/** What a body keeps of the budget before fields are added. */
const BODY_RESERVE = 1_000;
const length = (text: string) => [...text].length;

/**
 * Discord's message for `notice`: one embed, within Discord's limits (6 000 characters: the
 * title and footer, at least 1 000 for the body, the fields that fit, then the rest for the
 * body); mentions are never parsed.
 */
export const discordMessage = (notice: Notice, username?: string) => {
  const title = clip(notice.title, 256);
  const footer = clip(`${notice.level} · ${notice.source}`, 2048);
  // Title and footer first; up to 1 000 characters kept for the body; fields while they fit (the
  // last one cut to fit); then the body gets everything left.
  const reserved = Math.min(BODY_RESERVE, length(notice.body ?? ""));
  let left = EMBED_BUDGET - length(title) - length(footer) - reserved;
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  for (const f of (notice.fields ?? []).slice(0, 25)) {
    const name = clip(f.name, 256);
    const room = Math.min(1024, left - length(name));
    if (room < 2) break;
    const value = clip(f.value, room);
    fields.push({ name, value, inline: true });
    left -= length(name) + length(value);
  }
  const room = Math.min(4096, left + reserved);
  return {
    ...(username ? { username: clip(username, 80) } : {}),
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title,
        ...(notice.body && room > 1 ? { description: clip(notice.body, room) } : {}),
        ...(notice.link ? { url: notice.link.url } : {}),
        color: COLOR[notice.level],
        fields,
        footer: { text: footer },
        ...(notice.at ? { timestamp: notice.at } : {}),
      },
    ],
  };
};

export const discord = (options: { readonly webhookUrl: string; readonly username?: string; readonly minLevel?: Level; readonly name?: string; readonly fetch?: Fetch } & PostOptions): Channel => {
  const name = options.name ?? "discord";
  return {
    name,
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    deliver: (notice) => postJson(name, options.fetch ?? defaultFetch, options.webhookUrl, discordMessage(notice, options.username), options),
  };
};
