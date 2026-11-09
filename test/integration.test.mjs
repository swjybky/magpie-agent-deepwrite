import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { atomic, read } from "../lib/storage.mjs";
import { synchronize, connectionAt, MODEL_ID } from "../lib/sync.mjs";
import { handler } from "../lib/proxy.mjs";
import { paths } from "../lib/paths.mjs";
import { modelId } from "../lib/catalog.mjs";
import { agent, connect } from "../deepwrite.agent.js";
const c = {
  model: "fixture/writer",
  gateway: "https://gateway.example.test/v1",
  key: "invalid-fixture-key",
  selected: {
    id: "fixture/writer",
    name: "Writer",
    context: 128000,
    output: 16384,
    efforts: ["low", "medium", "high"],
  },
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "magpie-dw-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = {
    config: join(root, "models.json"),
    journal: join(root, "journal.json"),
  };
  const original = {
    version: 3,
    defaultModelId: "existing",
    models: [{ id: "existing", label: "Existing", provider: "magpie" }],
    encryptedApiKeys: { existing: "invalid-encrypted-placeholder" },
    enabledFreeModelIds: [],
    customFutureField: 42,
  };
  atomic(p.config, original);
  return { p, original };
}
test("connect, switch and disconnect preserve models, ciphertext and unrelated edits", (t) => {
  const { p, original } = fixture(t);
  synchronize(p, c, "http://127.0.0.1:1234/invalid-token/v1");
  assert.equal(read(p.config).defaultModelId, modelId(c.selected.id));
  assert.equal(
    read(p.config).encryptedApiKeys.existing,
    original.encryptedApiKeys.existing,
  );
  let d = read(p.config);
  d.customFutureField = 43;
  atomic(p.config, d);
  synchronize(
    p,
    { ...c, selected: { ...c.selected, name: "Changed" } },
    "http://127.0.0.1:1234/invalid-token/v1",
  );
  assert.equal(read(p.config).models.length, 2);
  synchronize(p, null, "");
  assert.deepEqual(read(p.config), { ...original, customFutureField: 43 });
  assert.equal(read(p.journal), null);
});
test("recovery after journal committed but before config write is safe", (t) => {
  const { p, original } = fixture(t);
  atomic(p.journal, {
    version: 1,
    config: p.config,
    previousDefault: "existing",
  });
  synchronize(p, null, "");
  assert.deepEqual(read(p.config), original);
});
test("disconnect preserves default model deliberately selected by user", (t) => {
  const { p } = fixture(t);
  synchronize(p, c, "http://127.0.0.1:1234/invalid-token/v1");
  const d = read(p.config);
  d.models.push({ id: "new" });
  d.defaultModelId = "new";
  atomic(p.config, d);
  synchronize(p, null, "");
  assert.equal(read(p.config).defaultModelId, "new");
});
test("unknown versions and ID collisions fail without overwriting config", (t) => {
  const { p, original } = fixture(t);
  atomic(p.config, { ...original, version: 9 });
  const raw = readFileSync(p.config, "utf8");
  assert.throws(() => synchronize(p, c, ""), /version 3/);
  assert.equal(readFileSync(p.config, "utf8"), raw);
  atomic(p.config, {
    ...original,
    models: [{ id: modelId(c.selected.id), provider: "magpie" }],
  });
  assert.throws(() => synchronize(p, c, ""), /already exists/);
});
test("connection uses dedicated agent credentials and rejects partial writes", (t) => {
  const { p } = fixture(t);
  const payload = connect({
    gateway: { v1: c.gateway, key: c.key },
    model: { ...c.selected },
  });
  atomic(p.config, { ...payload, model: c.model });
  assert.equal(connectionAt(p.config).key, c.key);
  atomic(p.config, { ...c, model: "other" });
  assert.throws(() => connectionAt(p.config), /Incomplete/);
  assert.equal(agent.id, "deepwrite");
  assert.equal(agent.model, undefined);
  const full = connect({
    gateway: { v1: c.gateway, key: c.key },
    models: [c.selected, { ...c.selected, id: "fixture/second" }],
  });
  assert.equal(full.models.length, 2);
});
test("paths follow DW storage migration pointer", (t) => {
  const root = mkdtempSync(join(tmpdir(), "magpie-dw-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appdata = join(root, "Library", "Application Support");
  atomic(join(appdata, "@deepwrite", ".desktop.storage-location.json"), {
    version: 1,
    currentPath: join(root, "moved"),
  });
  assert.equal(
    paths({}, "darwin", root).config,
    join(root, "moved", "config", "models.json"),
  );
});
test("proxy streams SSE, injects auth, forwards errors and rejects browser/stale requests", async (t) => {
  let received;
  const upstream = createServer((req, res) => {
    received = req.headers;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    setTimeout(() => res.end("data: [DONE]\n\n"), 10);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());
  const h = handler(
    () => ({ ...c, gateway: `http://127.0.0.1:${upstream.address().port}/v1` }),
    "invalid-test-token",
  );
  const request = (
    path = "/invalid-test-token/v1/chat/completions",
    headers = {},
    model = c.model,
  ) =>
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, stream: true }),
    });
  const result = await h(request());
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /event-stream/);
  assert.match(await result.text(), /\[DONE\]/);
  assert.equal(received.authorization, `Bearer ${c.key}`);
  assert.equal((await h(request("/wrong/v1/chat/completions"))).status, 404);
  assert.equal(
    (await h(request(undefined, { origin: "https://example.test" }))).status,
    403,
  );
  assert.equal((await h(request(undefined, {}, "other"))).status, 409);
  assert.equal(
    (await handler(() => null, "invalid-test-token")(request())).status,
    503,
  );
});

test("full catalog has stable independent magpie models, credentials, defaults and cleanup", (t) => {
  const { p, original } = fixture(t);
  const second = {
    ...c.selected,
    id: "fixture/second",
    name: "Second",
    native_endpoints: ["/v1/responses"],
  };
  const full = { ...c, catalogVersion: 2, models: [c.selected, second] };
  synchronize(p, full, "http://127.0.0.1:1234/invalid-token/v1");
  let state = read(p.config);
  assert.equal(state.models.length, 3);
  assert.deepEqual(
    state.models.slice(1).map((m) => m.provider),
    ["magpie", "magpie"],
  );
  assert.equal(state.models[2].api, "openai-responses");
  assert.equal(
    state.encryptedApiKeys[modelId(second.id)],
    original.encryptedApiKeys.existing,
  );
  state.defaultModelId = modelId(second.id);
  atomic(p.config, state);
  synchronize(p, full, "http://127.0.0.1:1234/invalid-token/v1");
  assert.equal(read(p.config).defaultModelId, modelId(second.id));
  synchronize(
    p,
    { ...full, models: [c.selected] },
    "http://127.0.0.1:1234/invalid-token/v1",
  );
  assert.equal(read(p.config).models.length, 2);
  assert.equal(read(p.config).encryptedApiKeys[modelId(second.id)], undefined);
  synchronize(p, null, "");
  assert.deepEqual(read(p.config), original);
});
test("legacy single Ollama entry migrates to complete magpie list and restores original default", (t) => {
  const { p, original } = fixture(t);
  atomic(p.config, {
    ...original,
    defaultModelId: MODEL_ID,
    models: [
      ...original.models,
      { id: MODEL_ID, provider: "ollama", modelId: c.model },
    ],
  });
  atomic(p.journal, {
    version: 1,
    config: p.config,
    previousDefault: original.defaultModelId,
  });
  synchronize(p, c, "http://127.0.0.1:1234/invalid-token/v1");
  const state = read(p.config);
  assert.equal(
    state.models.some((m) => m.id === MODEL_ID),
    false,
  );
  assert.equal(state.models[1].provider, "magpie");
  synchronize(p, null, "");
  assert.deepEqual(read(p.config), original);
});
test("catalog cannot overflow DW limit and never borrows other provider credentials", (t) => {
  const { p, original } = fixture(t);
  const models = Array.from({ length: 100 }, (_, i) => ({
    ...c.selected,
    id: `fixture/${i}`,
  }));
  assert.throws(() => synchronize(p, { ...c, models }, ""), /at most 100/);
  assert.deepEqual(read(p.config), original);
  assert.equal(read(p.journal, null), null);
  atomic(p.config, {
    ...original,
    models: [{ ...original.models[0], provider: "another" }],
  });
  assert.throws(() => synchronize(p, c, "", () => {
    throw new Error("safe storage unavailable");
  }), /safe storage unavailable/);
  assert.equal(read(p.journal, null), null);
});

test("first connection creates magpie without a seed and disconnect restores the original", (t) => {
  const { p, original } = fixture(t);
  const before = { ...original, models: [{ ...original.models[0], provider: "openai" }] };
  atomic(p.config, before);
  let calls = 0;
  const createCredential = (config) => {
    assert.equal(config, p.config);
    calls++;
    return "encrypted-local-placeholder";
  };
  synchronize(p, c, "http://127.0.0.1:1234/token/v1", createCredential);
  const saved = read(p.config);
  assert.equal(saved.models[1].provider, "magpie");
  assert.equal(saved.encryptedApiKeys[saved.models[1].id], "encrypted-local-placeholder");
  assert.equal(saved.encryptedApiKeys.existing, original.encryptedApiKeys.existing);
  synchronize(p, c, "http://127.0.0.1:5678/token/v1", createCredential);
  assert.equal(calls, 1);
  synchronize(p, null, "", () => assert.fail("disconnect must not access keychain"));
  assert.deepEqual(read(p.config), before);
});

test("first connection also supports an empty model list and no stored keys", (t) => {
  const { p } = fixture(t);
  const before = { version: 3, models: [], defaultModelId: "", encryptedApiKeys: {} };
  atomic(p.config, before);
  synchronize(p, c, "http://127.0.0.1:1234/token/v1", () => "encrypted-local-placeholder");
  assert.equal(read(p.config).models.length, 1);
  assert.equal(read(p.config).defaultModelId, modelId(c.model));
  synchronize(p, null, "");
  assert.deepEqual(read(p.config), before);
});
