import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { createBridgeCredential } from "../lib/credentials.mjs";

test("macOS creates a Chromium-compatible local placeholder and clears storage password", () => {
  const password = Buffer.from("fixture-safe-storage-password\n");
  const ciphertext = Buffer.from(createBridgeCredential("fixture/config", {
    platform: "darwin",
    run(command, args, options) {
      assert.equal(command, "/usr/bin/security");
      assert.deepEqual(args, ["find-generic-password", "-s", "@deepwrite/desktop Safe Storage", "-w"]);
      assert.equal(options.stdio[1], "pipe");
      return password;
    },
  }), "base64");
  assert.equal(ciphertext.subarray(0, 3).toString(), "v10");
  const key = pbkdf2Sync("fixture-safe-storage-password", "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  assert.equal(Buffer.concat([decipher.update(ciphertext.subarray(3)), decipher.final()]).toString(), "magpie-local-bridge");
  assert.ok(password.every((byte) => byte === 0));
});

test("keychain failures are redacted and throttled, then can recover", () => {
  let calls = 0;
  let time = 1000;
  const options = {
    platform: "darwin", now: () => time,
    run() { calls++; throw new Error("sensitive captured stdout"); },
  };
  assert.throws(() => createBridgeCredential("failure/config", options), (error) => {
    assert.ok(!error.message.includes("sensitive"));
    return true;
  });
  const previousCalls = calls;
  assert.throws(() => createBridgeCredential("failure/config", options), /钥匙串/);
  assert.equal(calls, previousCalls);
  time += 60001;
  assert.ok(createBridgeCredential("failure/config", {
    ...options, run: () => Buffer.from("fixture-password\n"),
  }));
});

test("unsupported systems do not call macOS security", () => {
  assert.throws(() => createBridgeCredential("other/config", {
    platform: "win32", run: () => assert.fail("must not run"),
  }), /尚不支持/);
});
