import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../lib/vault";
import { complete, MODEL, providerStatus, saveProvider, removeProvider, testProvider } from "../lib/provider";
import { outputSchema } from "../lib/analysis";
const key = "sk-synthetic-test-key-not-real";
function fixture() {
  const v = new Vault(mkdtempSync(path.join(tmpdir(), "agreement-api-test-")));
  v.unlock("synthetic test passphrase", true);
  return { v, clean() { v.lock(); rmSync(v.dir, { recursive: true, force: true }); } };
}
const input = [{ role: "system", content: "Follow the instruction pack." }, { role: "user", content: "Fictional agreement text." }];
const envelope = (value: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const signal = () => new AbortController().signal;

test("API credentials are encrypted, never returned in status, and unavailable while locked", () => {
  const { v, clean } = fixture();
  try {
    assert(!providerStatus(v).enabled);
    assert.throws(() => saveProvider("bad key", v), /valid OpenAI/);
    const status = saveProvider(key, v);
    assert(status.enabled);
    assert(!JSON.stringify(status).includes(key));
    const file = path.join(v.dir, "provider-settings.enc");
    assert(!readFileSync(file).includes(Buffer.from(key)));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(v.list(), []);
    v.lock();
    assert.throws(() => providerStatus(v), /Unlock/);
    assert.throws(() => saveProvider(key, v), /Unlock/);
    v.unlock("synthetic test passphrase");
    assert(providerStatus(v).enabled);
    assert(!removeProvider(v).enabled);
  } finally { clean(); }
});

test("Responses requests use server key, fixed HTTPS endpoint, strict schema and disabled response storage", async () => {
  const { v, clean } = fixture();
  try {
    saveProvider(key, v);
    let calls = 0;
    const mock: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, MODEL);
      assert.equal(body.store, false);
      assert.equal(body.background, false);
      assert.equal(body.stream, false);
      assert.equal(body.max_output_tokens, 16000);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.type, "json_schema");
      assert.deepEqual(body.text.format.schema, outputSchema);
      assert.deepEqual(body.input, input);
      for (const field of ["tools", "conversation", "previous_response_id", "files"]) assert(!(field in body));
      return Response.json(envelope({ summary: "Fictional only" }));
    };
    assert.deepEqual(await complete(input, signal(), v, mock), { summary: "Fictional only" });
    assert.equal(calls, 1);
  } finally { clean(); }
});

test("incomplete, refused, malformed and oversized provider output is rejected", async () => {
  const { v, clean } = fixture();
  try {
    saveProvider(key, v);
    for (const body of [
      { ...envelope({}), status: "incomplete" },
      { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Do not echo this" }] }] },
      { status: "completed", output: [] },
    ]) await assert.rejects(complete(input, signal(), v, async () => Response.json(body)));
    await assert.rejects(complete(input, signal(), v, async () => new Response("x".repeat(2_000_001))), /output limit/);
  } finally { clean(); }
});

test("upstream errors never reveal credentials or echoed document contents", async () => {
  const { v, clean } = fixture();
  try {
    saveProvider(key, v);
    for (const [status, expected] of [[401, /API key/], [403, /permissions/], [429, /billing/], [500, /temporarily/]] as const) {
      await assert.rejects(complete(input, signal(), v, async () => new Response(`${key} sensitive text`, { status })), (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, expected);
        assert(!error.message.includes(key));
        assert(!error.message.includes("sensitive text"));
        return true;
      });
    }
  } finally { clean(); }
});

test("missing credentials, exceeded context and cancellation stop before sending", async () => {
  const { v, clean } = fixture();
  let calls = 0;
  const mock: typeof fetch = async () => { calls++; return Response.json(envelope({})); };
  try {
    await assert.rejects(complete(input, signal(), v, mock), /API key/);
    saveProvider(key, v);
    await assert.rejects(complete([{ role: "user", content: "x".repeat(270000) }], signal(), v, mock), /No text was truncated/);
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(complete(input, stopped.signal, v, mock), /stopped/);
    assert.equal(calls, 0);
    const active = new AbortController();
    await assert.rejects(complete(input, active.signal, v, async (_url, init) => {
      active.abort();
      assert(init?.signal?.aborted);
      throw new Error("private network error");
    }), /stopped/);
  } finally { clean(); }
});

test("connection check sends no prompt and releases its lock cancellation handler", async () => {
  const { v, clean } = fixture();
  try {
    saveProvider(key, v);
    const result = await testProvider(v, async (url, init) => {
      assert.equal(url, `https://api.openai.com/v1/models/${MODEL}`);
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, "error");
      assert.equal(v.controllers.size, 1);
      return Response.json({ id: MODEL });
    });
    assert.match(result.message, /No agreement was sent/);
    assert.equal(v.controllers.size, 0);
  } finally { clean(); }
});

test("all structured output objects require every field and disallow unexpected properties", () => {
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort());
    }
    for (const child of Object.values(schema)) walk(child);
  }
  walk(outputSchema);
});
