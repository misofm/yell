// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Any HTTP endpoint that takes a notice as JSON (`Notice`'s encoding): `webhook` for a URL,
 * `relay` for another Yell (a notification service) reached by a URL or a Cloudflare service
 * binding, which reads it back with `decodeNotice`.
 */

import { Schema } from "effect";
import type { Channel } from "../Channel.ts";
import { type Level, Notice } from "../Notice.ts";
import { defaultFetch, type Fetch, type PostOptions, postJson } from "./http.ts";

const encode = Schema.encodeSync(Notice);

export const webhook = (options: {
  readonly url: string;
  /** Extra headers, e.g. an `authorization` the endpoint expects. */
  readonly headers?: Record<string, string>;
  readonly minLevel?: Level;
  readonly name?: string;
  readonly fetch?: Fetch;
} & PostOptions): Channel => {
  const name = options.name ?? "webhook";
  return {
    name,
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    deliver: (notice) => postJson(name, options.fetch ?? defaultFetch, options.url, encode(notice), options, options.headers),
  };
};

/**
 * Another Yell: a notification service. `binding` is a Cloudflare service binding (or any
 * object with `fetch`); `url` is the path it answers on (the host is not used by a binding).
 */
export const relay = (options: { readonly binding: { fetch: Fetch }; readonly url?: string; readonly minLevel?: Level; readonly name?: string } & PostOptions): Channel =>
  webhook({
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    ...(options.timeoutMillis !== undefined ? { timeoutMillis: options.timeoutMillis } : {}),
    ...(options.retries !== undefined ? { retries: options.retries } : {}),
    url: options.url ?? "https://yell.internal/notices",
    name: options.name ?? "relay",
    fetch: (request) => options.binding.fetch(request),
  });
