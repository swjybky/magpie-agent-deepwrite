import { homedir } from "node:os";
import { join, dirname, basename, isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function paths(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  const root =
    env.DEEPWRITE_MAGPIE_HOME || join(home, ".config", "magpie-deepwrite");
  const appdata =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA || join(home, "AppData", "Roaming")
        : env.XDG_CONFIG_HOME || join(home, ".config");
  const candidates = [
    join(appdata, "@deepwrite", "desktop"),
    join(appdata, "DeepWrite"),
  ];
  let data =
    env.DEEPWRITE_USER_DATA_PATH ||
    candidates.find((p) => existsSync(join(p, "config", "models.json"))) ||
    candidates[0];
  const pointer = join(
    dirname(data),
    `.${basename(data)}.storage-location.json`,
  );
  if (!env.DEEPWRITE_USER_DATA_PATH && existsSync(pointer)) {
    const state = JSON.parse(readFileSync(pointer, "utf8"));
    if (
      state.version !== 1 ||
      !isAbsolute(state.currentPath) ||
      state.pending
    ) {
      throw new Error(
        "DeepWrite storage is migrating or its location is invalid.",
      );
    }
    data = state.currentPath;
  }
  return {
    root,
    connection: join(root, "connection.json"),
    journal: join(root, "journal.json"),
    status: join(root, "status.json"),
    config: join(data, "config", "models.json"),
  };
}
