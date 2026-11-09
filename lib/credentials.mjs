import { execFileSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

// Only a disposable local-bridge placeholder is encrypted. Never decrypt or
// copy another provider's API key. The real agent key stays in connection.json.
const PLACEHOLDER = "magpie-local-bridge";
const failures = new Map();

// The script and command line contain no keys or profile paths. Only DW's
// DPAPI-wrapped storage key is passed on stdin; the raw key returns over a pipe.
const UNPROTECT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $wrapped = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $key = [Security.Cryptography.ProtectedData]::Unprotect($wrapped, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { [Console]::Out.Write([Convert]::ToBase64String($key)) }
  finally { [Array]::Clear($key, 0, $key.Length) }
} catch { [Console]::Error.Write('DW safe storage unavailable'); exit 1 }
`;

function windowsCredential(config, run, readFile, env) {
  // Follow the selected DW profile (including storage relocation). Never
  // generate/replace its master key or modify Chromium's Local State.
  const state = JSON.parse(readFile(join(dirname(dirname(config)), "Local State"), "utf8"));
  const encoded = state?.os_crypt?.encrypted_key;
  if (typeof encoded !== "string") throw new Error("Missing DW storage key");
  const wrapped = Buffer.from(encoded, "base64");
  if (wrapped.length <= 5 || wrapped.subarray(0, 5).toString() !== "DPAPI")
    throw new Error("Unsupported DW storage key");
  const powershell = win32.join(
    env.SystemRoot || env.SYSTEMROOT || "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
  );
  let output;
  let key;
  try {
    output = run(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(UNPROTECT, "utf16le").toString("base64"),
    ], {
      input: wrapped.subarray(5).toString("base64"),
      encoding: "buffer", stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, timeout: 15000,
    });
    key = Buffer.from(output.toString("utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("Invalid DW storage key");
    // Chromium OSCrypt Windows v10: prefix + 12-byte nonce + ciphertext + tag.
    // https://github.com/chromium/chromium/blob/145.0.7632.0/components/os_crypt/sync/os_crypt_win.cc
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    return Buffer.concat([
      Buffer.from("v10"), nonce, cipher.update(PLACEHOLDER, "utf8"),
      cipher.final(), cipher.getAuthTag(),
    ]).toString("base64");
  } finally {
    output?.fill(0);
    key?.fill(0);
  }
}

export function createBridgeCredential(
  config,
  {
    platform = process.platform, run = execFileSync, now = Date.now,
    readFile = readFileSync, env = process.env,
  } = {},
) {
  if (!["darwin", "win32"].includes(platform))
    throw new Error(
      "当前系统尚不支持自动创建 DW 加密凭据，请先在 DW 保存一个 magpie 模型及密钥。",
    );
  const previous = failures.get(config);
  const message = platform === "win32"
    ? "无法访问 DW 安全存储，请用同一 Windows 用户打开一次正式版 DW 后重试（不要使用另一账户运行 Magpie）。"
    : "无法访问 DW 安全存储，请打开过一次正式版 DW 并解锁系统钥匙串后重试。";
  if (previous !== undefined && now() - previous < 60000)
    throw new Error(message);
  if (platform === "win32") {
    try {
      const encrypted = windowsCredential(config, run, readFile, env);
      failures.delete(config);
      return encrypted;
    } catch {
      failures.set(config, now());
      throw new Error(message);
    }
  }
  // These are DW's two supported application names, not generic Electron or
  // browser keychains. A missing item must never create a replacement key.
  for (const name of ["@deepwrite/desktop", "DeepWrite"]) {
    let password;
    let key;
    try {
      password = run(
        "/usr/bin/security",
        ["find-generic-password", "-s", `${name} Safe Storage`, "-w"],
        { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      );
      // security appends one newline; preserve all password bytes otherwise.
      const secret = password.subarray(0, password.length - (password.at(-1) === 10 ? 1 : 0));
      if (!secret.length) throw new Error("Empty safe-storage password");
      // Chromium OSCrypt macOS v10, also used by Electron safeStorage.
      // https://chromium.googlesource.com/chromium/src/+/38c29b6535f88af0bbe843e0416390018d965da6/components/os_crypt/sync/os_crypt_mac.mm
      key = pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1");
      const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      const encrypted = Buffer.concat([
        Buffer.from("v10"), cipher.update(PLACEHOLDER, "utf8"), cipher.final(),
      ]).toString("base64");
      failures.delete(config);
      return encrypted;
    } catch {
      // Child-process errors may contain captured stdout/stderr. Never expose
      // them to the host logger or status.json.
    } finally {
      password?.fill(0);
      key?.fill(0);
    }
  }
  failures.set(config, now());
  throw new Error(message);
}
