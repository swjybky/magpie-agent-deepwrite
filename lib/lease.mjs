import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
export function claim(root) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, "runtime.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      const pid = Number(readFileSync(join(lock, "pid"), "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return false;
      } catch (cause) {
        if (cause.code !== "ESRCH") return false;
      }
    } catch {
      if (Date.now() - statSync(lock).mtimeMs < 5000) return false;
    }
    rmSync(lock, { recursive: true });
    // A different host may claim it first; it then owns the bridge.
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      return false;
    }
  }
  writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  return true;
}
export function release(root) {
  rmSync(join(root, "runtime.lock"), { recursive: true, force: true });
}
