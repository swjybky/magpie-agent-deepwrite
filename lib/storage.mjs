import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function read(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error("Cannot read bridge configuration.");
  }
}
export function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}
export function checkedWrite(path, before, after) {
  if (JSON.stringify(read(path)) !== JSON.stringify(before))
    throw new Error(
      "DeepWrite configuration changed; retry after closing DeepWrite.",
    );
  atomic(path, after);
}
