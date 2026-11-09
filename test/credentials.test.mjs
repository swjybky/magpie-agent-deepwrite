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
    platform: "linux", run: () => assert.fail("must not run"),
  }), /尚不支持/);
});

test("Windows wraps the placeholder with the selected DW profile key in Chromium GCM format", () => {
  const key = Buffer.alloc(32, 0x7a);
  const output = Buffer.from(key.toString("base64") + "\r\n");
  const wrapped = Buffer.from("DPAPIfixture-protected-key").toString("base64");
  const encrypted = Buffer.from(createBridgeCredential("moved-profile/config/models.json", {
    platform: "win32", env: { SystemRoot: "D:\\Windows" },
    readFile(path, encoding) {
      assert.equal(path.replaceAll("\\", "/"), "moved-profile/Local State");
      assert.equal(encoding, "utf8");
      return JSON.stringify({ os_crypt: { encrypted_key: wrapped } });
    },
    run(command, args, options) {
      assert.equal(command, "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
      assert.ok(args.includes("-NonInteractive"));
      const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
      assert.match(script, /ProtectedData\]::Unprotect/);
      assert.ok(!script.includes("fixture-protected-key"));
      assert.equal(Buffer.from(options.input, "base64").toString(), "fixture-protected-key");
      assert.equal(options.windowsHide, true);
      return output;
    },
  }), "base64");
  assert.equal(encrypted.subarray(0, 3).toString(), "v10");
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(3, 15));
  decipher.setAuthTag(encrypted.subarray(-16));
  assert.equal(Buffer.concat([
    decipher.update(encrypted.subarray(15, -16)), decipher.final(),
  ]).toString(), "magpie-local-bridge");
  assert.ok(output.every((byte) => byte === 0));
});

test("Windows refuses missing or unknown master keys without calling PowerShell", () => {
  for (const [i, state] of [{}, { os_crypt: { encrypted_key: Buffer.from("APPBunsupported").toString("base64") } }].entries()) {
    assert.throws(() => createBridgeCredential(`missing-${i}/config/models.json`, {
      platform: "win32", readFile: () => JSON.stringify(state),
      run: () => assert.fail("must not run"),
    }), /同一 Windows 用户/);
  }
});

test("Windows DPAPI failures are redacted and throttled", () => {
  let calls = 0;
  const options = {
    platform: "win32", now: () => 0,
    readFile: () => JSON.stringify({ os_crypt: { encrypted_key: Buffer.from("DPAPIfixture").toString("base64") } }),
    run() { calls++; throw new Error("sensitive captured stdout"); },
  };
  for (let i = 0; i < 2; i++) {
    assert.throws(() => createBridgeCredential("dpapi-failure/config/models.json", options), (error) => {
      assert.match(error.message, /Windows/);
      assert.ok(!error.message.includes("sensitive"));
      return true;
    });
  }
  assert.equal(calls, 1);
});
