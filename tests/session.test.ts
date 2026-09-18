import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, vault } from "../lib/vault";
import { AppError } from "../lib/errors";
import { ingest } from "../lib/ingest";
import { newRun } from "../lib/runner";
import { POST } from "../app/api/[...path]/route";

const passphrase = "synthetic session test passphrase";

test("malformed session tokens fail as unauthorized, including multibyte input", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "accord-token-test-"));
  const store = new Vault(dir);
  try {
    const token = store.unlock(passphrase, true);
    assert.doesNotThrow(() => store.authorize(token));
    for (const bad of [undefined, "", "é".repeat(64), "g".repeat(64), "0".repeat(64), token + "a"]) {
      assert.throws(() => store.authorize(bad), (error: unknown) => error instanceof AppError && error.status === 401);
    }
  } finally {
    store.lock();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an in-flight review cannot write after its session is revoked and replaced", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "accord-review-session-test-"));
  const previousDir = vault.dir;
  vault.dir = dir;
  try {
    const token = vault.unlock(passphrase, true);
    const matter = await ingest("synthetic.txt", readFileSync("examples/Synthetic-review-agreement.txt"));
    matter.source.confirmed_at = new Date().toISOString();
    const run = newRun(matter, { enabled: true, provider: "mock", model: "mock", maxCharacters: 120000, contextTokens: 262144, reason: "" });
    run.status = "complete";
    run.results.funding = { state: "complete", analysis: {
      coverage: "located", summary: "Synthetic fixture", open_questions: [], findings: [{
        id: "notice", stage: "notice", classification: "extracted", title: "Synthetic notice", analysis: "Fixture only",
        evidence: [{ block_id: matter.source.blocks[0].id, quote: matter.source.blocks[0].text }], depends_on: [],
      }],
    } };
    matter.runs.push(run);
    vault.save(matter, 0);
    const body = JSON.stringify({ revision: matter.revision, run_id: run.id, scenario_id: "funding", finding_id: "notice", state: "reviewed", note: "Revoked request", correction: "" });
    let revoked = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      revoked = true;
      vault.lock();
      vault.unlock(passphrase);
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    } }, { highWaterMark: 0 });
    const request = new Request(`http://127.0.0.1:4180/api/matters/${matter.id}/review`, {
      method: "POST", body: stream, duplex: "half",
      headers: { host: "127.0.0.1:4180", origin: "http://127.0.0.1:4180", "x-agreement-request": "1", cookie: `ale_session=${token}`, "content-type": "application/json" },
    } as RequestInit);
    const response = await POST(request, { params: Promise.resolve({ path: ["matters", matter.id, "review"] }) });
    assert(revoked, "the body must be read after the initial authorization");
    assert.equal(response.status, 401);
    const saved = vault.read(matter.id);
    assert.equal(saved.revision, matter.revision);
    assert.deepEqual(saved.runs[0].reviews, {});
  } finally {
    vault.lock();
    vault.dir = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
