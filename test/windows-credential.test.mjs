import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { atomic, read } from "../lib/storage.mjs";
import { synchronize } from "../lib/sync.mjs";
import { createBridgeCredential } from "../lib/credentials.mjs";

test("Windows first connect without magpie decrypts in real Electron and restores on disconnect", {
  skip: process.platform !== "win32" || !process.env.ELECTRON_BIN,
  timeout: 60000,
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), "magpie-windows-credential-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "config", "models.json");
  const original = {
    version: 3, models: [{ id: "deepseek-existing", provider: "deepseek" }],
    defaultModelId: "deepseek-existing", encryptedApiKeys: {},
  };
  atomic(config, original);
  function electron(action) {
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
    const result = spawnSync(resolve(process.env.ELECTRON_BIN), [resolve("test/fixtures/windows-credential.cjs")], {
      env: { ...env, DW_CREDENTIAL_TEST_PROFILE: root, DW_CREDENTIAL_TEST_ACTION: action },
      encoding: "utf8", timeout: 25000,
    });
    assert.equal(result.status, 0, `Electron ${action}: ${result.error?.message || result.stderr}`);
  }
  electron("seed");
  const localState = readFileSync(join(root, "Local State"), "utf8");
  assert.ok(JSON.parse(localState).os_crypt.encrypted_key);
  const paths = { config, journal: join(root, "journal.json") };
  const connection = {
    catalogVersion: 2, gateway: "http://127.0.0.1:12345/v1", key: "fixture-agent-key",
    models: [{ id: "fixture/first" }, { id: "fixture/second" }],
  };
  synchronize(paths, connection, "http://127.0.0.1:12346/fixture/v1", (path) => createBridgeCredential(path, {
    readFile(path, encoding) {
      const text = readFileSync(path, encoding);
      const key = Buffer.from(JSON.parse(text).os_crypt.encrypted_key, "base64");
      console.log("Fixture storage metadata", { dpapi: key.subarray(0, 5).toString() === "DPAPI", length: key.length });
      return text;
    },
    run(command, args, options) {
      try {
        const output = execFileSync(command, args, options);
        console.log("Fixture DPAPI returned", { outputLength: output.length, keyLength: Buffer.from(output.toString().trim(), "base64").length });
        return output;
      } catch (error) {
        console.log("Fixture DPAPI process failed", { code: error.code, status: error.status, signal: error.signal });
        throw error;
      }
    },
  }));
  assert.equal(read(config).models.length, 3);
  assert.equal(readFileSync(join(root, "Local State"), "utf8"), localState);
  electron("verify");
  synchronize(paths, null, "");
  assert.deepEqual(read(config), original);
});
