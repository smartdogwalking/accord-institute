import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vault } from "../lib/vault";
import { ingest } from "../lib/ingest";
import { newRun, activeJobs } from "../lib/runner";
import { saveProvider, providerStatus } from "../lib/provider";
import { POST, GET } from "../app/api/[...path]/route";

const passphrase = "synthetic boundary test passphrase";
const fakeKey = "sk-synthetic-test-key-not-real";
const mockProvider = { enabled: true, provider: "mock", model: "mock", maxCharacters: 120000, contextTokens: 262144, reason: "" };
function fixture() {
  const oldDir = vault.dir;
  const dir = mkdtempSync(path.join(tmpdir(), "accord-boundary-"));
  vault.dir = dir;
  const token = vault.unlock(passphrase, true);
  return { token, clean() { vault.lock(); vault.dir = oldDir; rmSync(dir, { recursive: true, force: true }); } };
}
function request(route: string, token: string, method = "POST", body?: BodyInit, contentType = "application/json") {
  return new Request(`http://127.0.0.1:4180/api/${route}`, {
    method, body, duplex: "half",
    headers: { host: "127.0.0.1:4180", origin: "http://127.0.0.1:4180", "x-agreement-request": "1", cookie: `ale_session=${token}`, "content-type": contentType },
  } as RequestInit);
}
function context(route: string) { return { params: Promise.resolve({ path: route.split("/") }) }; }
function rotatedBody(bytes: Uint8Array) {
  let rotations = 0;
  return {
    stream: new ReadableStream<Uint8Array>({ pull(controller) {
      rotations++;
      vault.lock(); vault.unlock(passphrase);
      controller.enqueue(bytes); controller.close();
    } }, { highWaterMark: 0 }),
    assertRotated() { assert.equal(rotations, 1); },
  };
}
async function reviewMatter() {
  const matter = await ingest("synthetic.txt", readFileSync("examples/Synthetic-review-agreement.txt"));
  matter.source.confirmed_at = new Date().toISOString();
  const run = newRun(matter, mockProvider);
  run.status = "complete";
  run.results.funding = { state: "complete", analysis: {
    coverage: "located", summary: "Synthetic only", open_questions: [], findings: [{
      id: "notice", stage: "notice", classification: "extracted", title: "Synthetic notice", analysis: "Synthetic only",
      evidence: [{ block_id: matter.source.blocks[0].id, quote: matter.source.blocks[0].text }], depends_on: [],
    }],
  } };
  matter.runs.push(run); vault.save(matter, 0);
  return { matter, run, route: `matters/${matter.id}/review`, body: {
    revision: matter.revision, run_id: run.id, scenario_id: "funding", finding_id: "notice", state: "reviewed", note: "Synthetic review", correction: "",
  } };
}

test("revoked API-key save cannot replace encrypted credentials", async () => {
  const { token, clean } = fixture();
  try {
    saveProvider(fakeKey);
    const file = path.join(vault.dir, "provider-settings.enc"), before = readFileSync(file);
    const delayed = rotatedBody(new TextEncoder().encode(JSON.stringify({ apiKey: fakeKey })));
    const result = await POST(request("provider", token, "POST", delayed.stream), context("provider"));
    delayed.assertRotated();
    assert.equal(result.status, 401);
    assert.deepEqual(readFileSync(file), before);
  } finally { clean(); }
});

test("revoked document import leaves the vault unchanged", async () => {
  const { token, clean } = fixture();
  try {
    const form = new FormData();
    form.set("document", new File([readFileSync("examples/Synthetic-review-agreement.txt")], "synthetic.txt"));
    const serialized = new Response(form);
    const delayed = rotatedBody(new Uint8Array(await serialized.arrayBuffer()));
    const result = await POST(request("matters", token, "POST", delayed.stream, serialized.headers.get("content-type")!), context("matters"));
    delayed.assertRotated();
    assert.equal(result.status, 401);
    assert.deepEqual(vault.list(), []);
  } finally { clean(); }
});

test("locking without reopening rejects a delayed review, and reopening reveals no write", async () => {
  const { token, clean } = fixture();
  try {
    const { matter, route, body } = await reviewMatter();
    const before = readFileSync(path.join(vault.dir, `${matter.id}.vault`));
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      vault.lock(); controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
    } }, { highWaterMark: 0 });
    const result = await POST(request(route, token, "POST", stream), context(route));
    assert.equal(result.status, 401);
    vault.unlock(passphrase);
    assert.deepEqual(readFileSync(path.join(vault.dir, `${matter.id}.vault`)), before);
    assert.deepEqual(vault.read(matter.id).runs[0].reviews, {});
  } finally { clean(); }
});

test("valid review saves and stale revision cannot overwrite its notes or generated output", async () => {
  const { token, clean } = fixture();
  try {
    const { matter, route, body } = await reviewMatter();
    const original = structuredClone(matter.runs[0].results);
    assert.equal((await POST(request(route, token, "POST", JSON.stringify(body)), context(route))).status, 200);
    const saved = vault.read(matter.id);
    assert.equal(saved.revision, matter.revision + 1);
    assert.deepEqual(saved.runs[0].results, original);
    assert.equal(saved.runs[0].reviews["funding:notice"].note, body.note);
    assert.equal((await POST(request(route, token, "POST", JSON.stringify({ ...body, note: "Stale note" })), context(route))).status, 409);
    assert.deepEqual(vault.read(matter.id), saved);
  } finally { clean(); }
});

test("a slower competing review cannot overwrite the review saved while its body arrives", async () => {
  const { token, clean } = fixture();
  try {
    const { matter, route, body } = await reviewMatter();
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      entered(); await wait;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...body, note: "Slower note" }))); controller.close();
    } }, { highWaterMark: 0 });
    const pending = POST(request(route, token, "POST", stream), context(route));
    await ready;
    const fast = await POST(request(route, token, "POST", JSON.stringify(body)), context(route));
    release();
    assert.equal(fast.status, 200);
    assert.equal((await pending).status, 409);
    const saved = vault.read(matter.id);
    assert.equal(saved.revision, matter.revision + 1);
    assert.equal(saved.runs[0].reviews["funding:notice"].note, body.note);
  } finally { clean(); }
});

test("provider save rechecks active runs after receiving its body", async () => {
  const { token, clean } = fixture();
  const job = "synthetic-boundary-job";
  try {
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      activeJobs.add(job);
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ apiKey: fakeKey }))); controller.close();
    } }, { highWaterMark: 0 });
    const result = await POST(request("provider", token, "POST", stream), context("provider"));
    assert.equal(result.status, 409);
    assert(!providerStatus().enabled);
    assert(!existsSync(path.join(vault.dir, "provider-settings.enc")));
  } finally { activeJobs.delete(job); clean(); }
});

test("malformed HTTP cookies and replaced tokens return unauthorized without private content", async () => {
  const { token, clean } = fixture();
  try {
    for (const bad of ["", "g".repeat(64), "A".repeat(64), "é".repeat(64), "0".repeat(63), "0".repeat(65), "0".repeat(64)]) {
      const result = await GET(request("matters", bad, "GET"), context("matters"));
      assert.equal(result.status, 401);
      assert.deepEqual(await result.json(), { error: "Unlock your vault to continue." });
    }
    vault.lock(); const replacement = vault.unlock(passphrase);
    assert.notEqual(token, replacement);
    assert.equal((await GET(request("matters", token, "GET"), context("matters"))).status, 401);
    assert.equal((await GET(request("matters", replacement, "GET"), context("matters"))).status, 200);
  } finally { clean(); }
});
