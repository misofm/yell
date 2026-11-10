// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { type Channel, DeliveryFailed, decodeNotice, discord, discordMessage, LIMITS, log, type Notice, normalizeNotice, relay, slack, webhook, Yell } from "../src/index.ts";

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

describe("normalizeNotice", () => {
  test("a notice that doesn't fit is made to fit, never dropped", async () => {
    const a = recorder("a");
    const messy = { title: "t".repeat(500), level: "critical", source: "", body: "", fields: Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, value: "" })), link: { label: "x", url: "javascript:alert(1)" }, at: "yesterday" } as Notice;
    expect(await run(Yell.make({ channels: [a.channel] }).send(messy))).toMatchObject({ _tag: "Sent", delivered: ["a"] });
    const sent = a.got[0]!;
    expect([...sent.title].length).toBe(LIMITS.title);
    expect(sent.title.endsWith("…")).toBe(true);
    expect(sent.source).toBe("(unknown)");
    expect(sent.body).toBeUndefined();
    expect(sent.fields).toHaveLength(10);
    expect(sent.fields?.[0]?.value).toBe("-");
    expect(sent.link).toBeUndefined();
    expect(Number.isNaN(Date.parse(sent.at!))).toBe(false);
    // What comes out is a valid Notice: it survives the wire.
    expect(await run(decodeNotice(JSON.parse(JSON.stringify(sent))))).toEqual(sent);
  });

  test("a valid notice is unchanged", () => {
    expect(normalizeNotice(notice)).toEqual(notice);
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

  test("discord keeps the embed within Discord's 6 000 characters", () => {
    const big: Notice = { ...notice, title: "t".repeat(200), body: "b".repeat(4000), fields: Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`.padEnd(100, "n"), value: "v".repeat(500) })) };
    const embed = discordMessage(big).embeds[0]!;
    const total = [embed.title, embed.description ?? "", embed.footer.text, ...embed.fields.flatMap((f) => [f.name, f.value])].reduce((n, t) => n + [...t].length, 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(embed.description?.endsWith("…")).toBe(true);
  });

  test("a 429 or 5xx is retried once, honouring Retry-After; another 4xx never is", async () => {
    const answers = [new Response("slow down", { status: 429, headers: { "retry-after": "0" } }), new Response("ok")];
    let calls = 0;
    const flaky = async () => (calls++, answers.shift()!);
    await run(slack({ webhookUrl: "https://hooks.slack.com/x", fetch: flaky }).deliver(notice));
    expect(calls).toBe(2);
    calls = 0;
    const gone = async () => (calls++, new Response("no", { status: 404 }));
    expect((await run(Effect.flip(slack({ webhookUrl: "https://hooks.slack.com/x", fetch: gone }).deliver(notice)))).reason).toBe("answered HTTP 404");
    expect(calls).toBe(1);
    calls = 0;
    const down = async () => (calls++, new Response("", { status: 503, headers: { "retry-after": "0" } }));
    expect((await run(Effect.flip(slack({ webhookUrl: "https://hooks.slack.com/x", fetch: down, retries: 2 }).deliver(notice)))).reason).toBe("answered HTTP 503");
    expect(calls).toBe(3);
  });

  test("log is a channel that always works", async () => {
    expect(await run(Yell.make({ channels: [log()] }).send(notice))).toMatchObject({ _tag: "Sent", delivered: ["log"] });
  });

  test("relay posts the notice itself, which the other end decodes as it was", async () => {
    const http = capture();
    await run(relay({ binding: { fetch: http.fetch } }).deliver(notice));
    expect(http.requests[0]!.url).toBe("https://yell.internal/notices");
    expect(await run(decodeNotice(http.requests[0]!.body))).toEqual(notice);
    expect(Schema.is(Schema.String)(http.requests[0]!.headers.get("content-type"))).toBe(true);
  });
});
