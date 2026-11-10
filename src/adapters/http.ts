// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Posting JSON for the HTTP adapters: a timeout, and failures that never carry the URL. */

import { Duration, Effect } from "effect";
import { DeliveryFailed } from "../Channel.ts";

/** Anything that sends a `Request`: the global `fetch`, or a Cloudflare service binding. */
export type Fetch = (request: Request) => Promise<Response>;

/** How a channel posts: a timeout per attempt, and retries of what may pass on a second try. */
export interface PostOptions {
  /** Per attempt, in milliseconds. Default 5 000. */
  readonly timeoutMillis?: number;
  /**
   * Further attempts after a 429, a 5xx, a timeout or no answer, waiting `Retry-After` (at most
   * 5 s) or 500 ms first. Default 1; 0 never retries. A 4xx other than 429 is never retried.
   */
  readonly retries?: number;
}

/** `Retry-After` in milliseconds (seconds or an HTTP date), at most 5 s; 500 ms without one. */
const retryDelay = (response: Response | undefined) => {
  const header = response?.headers.get("retry-after");
  if (!header) return 500;
  const seconds = Number(header);
  const millis = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Math.min(5_000, Math.max(0, Number.isFinite(millis) ? millis : 500));
};

interface Attempt {
  readonly reason: string;
  readonly retry: boolean;
  readonly response: Response | undefined;
}

const drain = (response: Response) => Effect.promise(() => response.body?.cancel() ?? Promise.resolve());

export const postJson = (channel: string, fetcher: Fetch, url: string, body: unknown, options: PostOptions = {}, headers: Record<string, string> = {}) => {
  const timeoutMillis = options.timeoutMillis ?? 5_000;
  const attempt: Effect.Effect<void, Attempt> = Effect.tryPromise({
    try: () =>
      fetcher(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMillis),
        }),
      ),
    catch: (cause): Attempt => ({ reason: cause instanceof Error && cause.name === "TimeoutError" ? "timed out" : "could not be reached", retry: true, response: undefined }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.asVoid(drain(response))
        : drain(response).pipe(Effect.andThen(Effect.fail<Attempt>({ reason: `answered HTTP ${response.status}`, retry: response.status === 429 || response.status >= 500, response }))),
    ),
  );
  const go = (left: number): Effect.Effect<void, DeliveryFailed> =>
    attempt.pipe(
      Effect.catch((e) =>
        e.retry && left > 0 ? Effect.sleep(Duration.millis(retryDelay(e.response))).pipe(Effect.andThen(go(left - 1))) : Effect.fail(new DeliveryFailed({ channel, reason: e.reason })),
      ),
    );
  return go(options.retries ?? 1);
};

/** `text` cut to `max` characters, with an ellipsis when cut. */
export const clip = (text: string, max: number) => ([...text].length <= max ? text : `${[...text].slice(0, max - 1).join("")}…`);

export const defaultFetch: Fetch = (request) => fetch(request);
