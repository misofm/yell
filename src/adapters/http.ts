// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Posting JSON for the HTTP adapters: a timeout, and failures that never carry the URL. */

import { Effect } from "effect";
import { DeliveryFailed } from "../Channel.ts";

/** Anything that sends a `Request`: the global `fetch`, or a Cloudflare service binding. */
export type Fetch = (request: Request) => Promise<Response>;

export const postJson = (channel: string, fetcher: Fetch, url: string, body: unknown, timeoutMillis: number, headers: Record<string, string> = {}) =>
  Effect.tryPromise({
    try: () =>
      fetcher(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMillis),
        }),
      ),
    catch: (cause) => new DeliveryFailed({ channel, reason: cause instanceof Error && cause.name === "TimeoutError" ? "timed out" : "could not be reached" }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.promise(() => response.body?.cancel() ?? Promise.resolve()).pipe(Effect.asVoid)
        : Effect.fail(new DeliveryFailed({ channel, reason: `answered HTTP ${response.status}` })),
    ),
  );

/** `text` cut to `max` characters, with an ellipsis when cut. */
export const clip = (text: string, max: number) => ([...text].length <= max ? text : `${[...text].slice(0, max - 1).join("")}…`);

export const defaultFetch: Fetch = (request) => fetch(request);
