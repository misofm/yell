// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { type Channel, DeliveryFailed, decodeNotice, discord, type Notice, relay, slack, webhook, Yell } from "../src/index.ts";

const notice: Notice = { title: "Pool stock low", level: "warning", source: "miso-share-currency-pool-service-testnet", fields: [{ name: "Compositions ready", value: "3" }] };
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** A channel that records what it got, or fails / crashes on demand. */
const recorder = (name: string, behaviour: "ok" | "fail" | "crash" = "ok", minLevel?: Notice["level"]) => {
  const got: Notice[] = [];
  const channel: Channel = {
    name,
    ...(minLevel ? { minLevel } : {}),
    deliver: (n) =>
      behaviour === "ok" ? Effect.sync(() => void got.push(n)) : behaviour === "fail" ? Effect.fail(new DeliveryFailed({ channel: name, reason: "answered HTTP 500" })) : Effect.die(new Error("boom")),
  };
  return { channel, got };
};

describe("Yell", () => {
  test("sends to every channel; one failing or crashing doesn't stop the others or the caller", async () => {
    const a = recorder("a"), b = recorder("b", "fail"), c = recorder("c", "crash");
    const report = await run(Yell.make({ channels: [a.channel, b.channel, c.channel] }).send(notice));
    expect(report).toEqual({ _tag: "Sent", delivered: ["a"], skipped: [], failed: [{ channel: "b", reason: "answered HTTP 500" }, { channel: "c", reason: "the channel crashed" }] });
    expect(a.got[0]?.title).toBe("Pool stock low");
    expect(typeof a.got[0]?.at).toBe("string");
  });

  test("a channel's minLevel skips quieter notices", async () => {
    const all = recorder("all"), loud = recorder("loud", "ok", "critical");
    const yell = Yell.make({ channels: [all.channel, loud.channel], cooldown: 0 });
    expect(await run(yell.send(notice))).toMatchObject({ delivered: ["all"], skipped: ["loud"] });
    expect(await run(yell.send({ ...notice, level: "critical" }))).toMatchObject({ delivered: ["all", "loud"], skipped: [] });
  });

  test("repeats within the cooldown are held back, and the next one says how many", async () => {
    let clock = 0;
    const a = recorder("a");
    const yell = Yell.make({ channels: [a.channel], cooldown: "10 minutes", now: () => clock });
    await run(yell.send(notice));
    clock += 60_000;
    expect(await run(yell.send(notice))).toEqual({ _tag: "Throttled", key: `${notice.source}\u0000${notice.title}` });
    expect(await run(yell.send({ ...notice, key: "other" }))).toMatchObject({ _tag: "Sent" });
    await run(yell.send(notice));
    clock += 10 * 60_000;
    await run(yell.send(notice));
    expect(a.got).toHaveLength(3);
    expect(a.got[2]?.fields?.at(-1)).toEqual({ name: "Held back", value: "2 more like this since the last one" });
  });
});

describe("Notice", () => {
  test("decodes from untrusted JSON, and refuses what doesn't fit", async () => {
    expect(await run(decodeNotice(JSON.parse(JSON.stringify(notice))))).toEqual(notice);
    for (const bad of [{ ...notice, level: "loud" }, { ...notice, title: "" }, { ...notice, link: { label: "x", url: "javascript:alert(1)" } }, { title: "x", level: "info" }]) {
      expect(await run(Effect.result(decodeNotice(bad)).pipe(Effect.map((r) => r._tag)))).toBe("Failure");
    }
  });
});

describe("adapters", () => {
  const capture = () => {
    const requests: Array<{ url: string; body: any; headers: Headers }> = [];
    let status = 200;
    return {
      requests,
      fail: (s: number) => (status = s),
      fetch: async (request: Request) => (requests.push({ url: request.url, body: await request.json(), headers: request.headers }), new Response("ok", { status })),
    };
  };

  test("slack posts Block Kit, escapes mrkdwn so a notice can't mention or link", async () => {
    const http = capture();
    await run(slack({ webhookUrl: "https://hooks.slack.com/services/SECRET", fetch: http.fetch }).deliver({ ...notice, fields: [{ name: "who", value: "<!channel> <https://evil|x>" }], link: { label: "Status", url: "https://example.com" } }));
    const body = http.requests[0]!.body;
    expect(body.text).toBe("WARNING: Pool stock low (miso-share-currency-pool-service-testnet)");
    expect(body.blocks.map((b: { type: string }) => b.type)).toEqual(["header", "section", "actions", "context"]);
    expect(body.blocks[1].fields[0].text).toBe("*who*\n&lt;!channel&gt; &lt;https://evil|x&gt;");
  });

  test("discord posts one embed and never parses mentions", async () => {
    const http = capture();
    await run(discord({ webhookUrl: "https://discord.com/api/webhooks/SECRET", fetch: http.fetch }).deliver({ ...notice, title: "x".repeat(300) }));
    const body = http.requests[0]!.body;
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect([...body.embeds[0].title].length).toBe(256);
    expect(body.embeds[0].color).toBe(0xf59e0b);
  });

  test("a failed post says why without the webhook URL (a credential)", async () => {
    const http = capture();
    http.fail(404);
    const failed = await run(Effect.flip(slack({ webhookUrl: "https://hooks.slack.com/services/SECRET", fetch: http.fetch }).deliver(notice)));
    expect(failed).toMatchObject({ _tag: "@misofm/yell/DeliveryFailed", channel: "slack", reason: "answered HTTP 404" });
    expect(JSON.stringify(failed)).not.toContain("SECRET");
    const unreachable = await run(Effect.flip(webhook({ url: "https://x.test/SECRET", fetch: () => Promise.reject(new TypeError("fetch failed")) }).deliver(notice)));
    expect(unreachable.reason).toBe("could not be reached");
  });

  test("relay posts the notice itself, which the other end decodes as it was", async () => {
    const http = capture();
    await run(relay({ binding: { fetch: http.fetch } }).deliver(notice));
    expect(http.requests[0]!.url).toBe("https://yell.internal/notices");
    expect(await run(decodeNotice(http.requests[0]!.body))).toEqual(notice);
    expect(Schema.is(Schema.String)(http.requests[0]!.headers.get("content-type"))).toBe(true);
  });
});
