import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const base = "http://127.0.0.1:4180/api/";
let cookie = "";
async function request(route: string, method = "GET", body?: unknown) {
  return fetch(base + route, {
    method,
    headers: {
      origin: "http://127.0.0.1:4180",
      "x-agreement-request": "1",
      cookie,
      ...(body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
}
async function main() {
  if (process.env.AGREEMENT_RUN_QA !== "yes")
    throw new Error(
      "This harness is only for a dedicated QA server and vault. Set AGREEMENT_RUN_QA=yes after starting the server with AGREEMENT_DATA_DIR pointing to .runtime/qa-vault.",
    );
  assert.equal((await request("matters")).status, 401);
  assert.equal(
    (
      await fetch(base + "session", {
        method: "POST",
        headers: {
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  const session = await (await request("session")).json();
  const open = await request("session", "POST", {
    passphrase: "synthetic QA vault passphrase",
    create: !session.configured,
  });
  assert.equal(open.status, 200);
  cookie = open.headers.get("set-cookie")!.split(";")[0];
  const form = new FormData();
  form.set(
    "document",
    new File(
      [readFileSync("examples/Synthetic-review-agreement.txt")],
      "Synthetic-review-agreement.txt",
      { type: "text/plain" },
    ),
  );
  const imported = await request("matters", "POST", form);
  assert.equal(imported.status, 201);
  let m = await imported.json();
  assert(!("original" in m.source));
  assert.equal(m.source.blocks.length, 5);
  const blocked = await request(`matters/${m.id}/analyze`, "POST");
  assert.equal(blocked.status, 400);
  assert.equal((await request(`matters/${m.id}/original`)).status, 200);
  assert.equal((await request(`matters/${m.id}/confirm`, "POST")).status, 200);
  for (const extension of ["pdf", "docx"]) {
    const fileForm = new FormData();
    fileForm.set(
      "document",
      new File(
        [readFileSync(`tests/fixtures/synthetic.${extension}`)],
        `synthetic.${extension}`,
      ),
    );
    const uploaded = await request("matters", "POST", fileForm);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const parsed = await uploaded.json();
    assert(parsed.source.blocks[0].text.includes("10 business days"));
  }
  // Synthetic key exercises local settings only; never call provider/test or analyze with it.
  const fakeKey = "sk-synthetic-test-key-not-real";
  const connected = await request("provider", "POST", { apiKey: fakeKey });
  assert.equal(connected.status, 200);
  const connectionText = await connected.text();
  assert(!connectionText.includes(fakeKey));
  assert(JSON.parse(connectionText).enabled);
  const pack = await (await request("instructions")).json();
  assert(pack.provider.enabled);
  assert.equal(pack.provider.provider, "OpenAI API");
  const backup = await request("backup");
  assert.equal(backup.status, 200);
  const text = await backup.text();
  assert(!text.includes("Alpha Member"));
  assert(!text.includes("provider-settings.enc"));
  assert(!text.includes(fakeKey));
  assert.equal((await request("provider", "DELETE")).status, 200);
  assert(!(await (await request("instructions")).json()).provider.enabled);
  mkdirSync(".runtime/qa", { recursive: true });
  writeFileSync(".runtime/qa/backup.json", text);
  const response = await request(`matters/${m.id}`);
  m = await response.json();
  writeFileSync(".runtime/qa/matter-id", m.id);
  assert.equal((await request("session", "DELETE")).status, 200);
  assert.equal((await request("matters")).status, 401);
  assert.equal((await request("provider", "POST", { apiKey: fakeKey })).status, 401);
  console.log(
    "HTTP integration passed: unlock, protected routes, cross-site protection, import, source confirmation, encrypted backup, original download, encrypted API-key settings, credential exclusion from backup and lock.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
