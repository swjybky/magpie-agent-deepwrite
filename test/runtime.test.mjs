import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { atomic, read } from "../lib/storage.mjs";
const bun = process.env.BUN_BIN;
test(
  "Bun runtime connects DW, serves streaming traffic, observes off and recovers SIGTERM",
  { skip: !bun, timeout: 15000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "magpie-dw-runtime-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const config = join(root, "dw/config/models.json");
    const original = {
      version: 3,
      models: [{ id: "existing" }],
      defaultModelId: "existing",
      encryptedApiKeys: {},
    };
    atomic(config, original);
    const gateway = createServer((req, res) => {
      assert.equal(
        req.headers.authorization,
        "Bearer invalid-runtime-fixture-key",
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
    });
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
    t.after(() => gateway.close());
    const c = {
      model: "fixture/writer",
      key: "invalid-runtime-fixture-key",
      gateway: `http://127.0.0.1:${gateway.address().port}/v1`,
      selected: {
        id: "fixture/writer",
        name: "Writer",
        context: 128000,
        output: 16384,
        efforts: [],
      },
    };
    const connection = join(root, "bridge/connection.json");
    atomic(connection, c);
    const child = spawn(
      bun,
      [
        "--eval",
        'import { DeepWritePlugin } from "./index.mjs"; await DeepWritePlugin();',
      ],
      {
        cwd: resolve("."),
        env: {
          ...process.env,
          DEEPWRITE_MAGPIE_HOME: join(root, "bridge"),
          DEEPWRITE_USER_DATA_PATH: join(root, "dw"),
        },
        stdio: "pipe",
      },
    );
    let errors = "";
    child.stderr.on("data", (d) => (errors += d));
    t.after(() => child.kill());
    async function until(check) {
      for (let i = 0; i < 80; i++) {
        if (check()) return;
        await delay(50);
      }
      assert.fail(`Runtime timed out: ${errors}`);
    }
    await until(() => read(config).models.length === 2);
    const model = read(config).models[1];
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: c.model, stream: true }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /DONE/);
    atomic(connection, {});
    await until(() => read(config).models.length === 1);
    assert.deepEqual(read(config), original);
    atomic(connection, c);
    await until(() => read(config).models.length === 2);
    child.kill("SIGTERM");
    await once(child, "exit");
    assert.deepEqual(read(config), original);
  },
);
