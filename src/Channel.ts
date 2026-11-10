// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/** A channel: somewhere notices go (`src/adapters/`). Write your own by implementing `Channel`. */

import { type Effect, Schema } from "effect";
import type { Level, Notice } from "./Notice.ts";

/**
 * A notice did not reach a channel. `reason` is safe to log and show: adapters never put
 * credentials (webhook URLs, tokens) in it.
 */
export class DeliveryFailed extends Schema.TaggedError<DeliveryFailed>()("@misofm/yell/DeliveryFailed", {
  channel: Schema.String,
  reason: Schema.String,
}) {}

export interface Channel {
  /** Names the channel in reports and logs, e.g. `slack`. */
  readonly name: string;
  /** Notices below this level skip the channel. Default: every level. */
  readonly minLevel?: Level;
  readonly deliver: (notice: Notice) => Effect.Effect<void, DeliveryFailed>;
}
