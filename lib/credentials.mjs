import { execFileSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync } from "node:crypto";

// Only a disposable local-bridge placeholder is encrypted. Never decrypt or
// copy another provider's API key. The real agent key stays in connection.json.
const PLACEHOLDER = "magpie-local-bridge";
const failures = new Map();

export function createBridgeCredential(
  config,
  { platform = process.platform, run = execFileSync, now = Date.now } = {},
) {
  if (platform !== "darwin")
    throw new Error(
      "当前系统尚不支持自动创建 DW 加密凭据，请先在 DW 保存一个 magpie 模型及密钥。",
    );
  const previous = failures.get(config);
  if (previous !== undefined && now() - previous < 60000)
    throw new Error("无法访问 DW 安全存储，请解锁系统钥匙串后稍候重试。");
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
  throw new Error("无法访问 DW 安全存储，请打开过一次正式版 DW 并解锁系统钥匙串后重试。");
}
