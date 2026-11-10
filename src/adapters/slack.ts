// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Slack, through an incoming webhook (https://api.slack.com/messaging/webhooks), as Block Kit. */

import type { Channel } from "../Channel.ts";
import type { Level, Notice } from "../Notice.ts";
import { clip, defaultFetch, type Fetch, postJson } from "./http.ts";

const EMOJI: Record<Level, string> = { info: ":large_blue_circle:", warning: ":large_orange_circle:", critical: ":red_circle:" };

/** Slack's message for `notice`: a header, the body, the fields, the source and level, a link. */
export const slackMessage = (notice: Notice) => ({
  // Shown in notifications and where blocks can't be.
  text: clip(`${notice.level.toUpperCase()}: ${notice.title} (${notice.source})`, 3000),
  blocks: [
    { type: "header", text: { type: "plain_text", text: clip(notice.title, 150), emoji: true } },
    ...(notice.body ? [{ type: "section", text: { type: "plain_text", text: clip(notice.body, 3000), emoji: false } }] : []),
    ...(notice.fields?.length
      ? [{ type: "section", fields: notice.fields.slice(0, 10).map((f) => ({ type: "mrkdwn", text: clip(`*${escape(f.name)}*\n${escape(f.value)}`, 2000) })) }]
      : []),
    ...(notice.link
      ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: clip(notice.link.label, 75) }, url: notice.link.url }] }]
      : []),
    { type: "context", elements: [{ type: "mrkdwn", text: clip(`${EMOJI[notice.level]} ${notice.level} · ${escape(notice.source)}${notice.at ? ` · ${notice.at}` : ""}`, 3000) }] },
  ],
});

/** Slack's mrkdwn control characters, so a notice's text can't format or mention. */
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const slack = (options: { readonly webhookUrl: string; readonly minLevel?: Level; readonly name?: string; readonly fetch?: Fetch; readonly timeoutMillis?: number }): Channel => {
  const name = options.name ?? "slack";
  return {
    name,
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    deliver: (notice) => postJson(name, options.fetch ?? defaultFetch, options.webhookUrl, slackMessage(notice), options.timeoutMillis ?? 5_000),
  };
};
