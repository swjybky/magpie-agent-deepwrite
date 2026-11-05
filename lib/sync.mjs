import { read, atomic, checkedWrite } from "./storage.mjs";
import { catalog, modelEntry, MODEL_ID } from "./catalog.mjs";
export { MODEL_ID, modelEntry } from "./catalog.mjs";
export function connectionAt(path) {
  const value = read(path, null);
  if (!value?.key || (!value?.model && value?.catalogVersion !== 2))
    return null;
  const url = new URL(value.gateway);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid gateway URL.");
  if (value.catalogVersion !== 2 && value.selected?.id !== value.model)
    throw new Error("Incomplete model change; waiting for Magpie.");
  if (!catalog(value).length)
    throw new Error("No Magpie models are available to DeepWrite.");
  return value;
}
export function synchronize(p, connection, baseUrl) {
  const before = read(p.config, null);
  let journal = read(p.journal, null);
  if (!before) {
    if (connection)
      throw new Error(
        "Open DeepWrite once before connecting, or set DEEPWRITE_USER_DATA_PATH.",
      );
    return;
  }
  if (
    before.version !== 3 ||
    !Array.isArray(before.models) ||
    !before.encryptedApiKeys
  )
    throw new Error("Requires DeepWrite models.json version 3.");
  if (journal && journal.config !== p.config)
    throw new Error("Disconnect before changing DeepWrite data locations.");
  const after = structuredClone(before);
  // Only IDs recorded in our journal are owned by this integration.
  const owned = new Set(journal ? journal.modelIds || [MODEL_ID] : []);
  if (connection) {
    const entries = catalog(connection).map((m) => modelEntry(m, baseUrl));
    const retained = before.models.filter((m) => !owned.has(m.id));
    if (retained.length + entries.length > 100)
      throw new Error(
        `DeepWrite supports at most 100 models; ${retained.length} existing + ${entries.length} Magpie models. Reduce models visible to DeepWrite in Magpie.`,
      );
    if (entries.some((m) => retained.some((existing) => existing.id === m.id)))
      throw new Error("Dedicated model ID already exists.");
    // Reuse only a Magpie credential, never unrelated providers' credentials.
    // Ciphertext stays opaque; the bridge replaces auth with the dedicated agent key.
    const source = before.models.find(
      (m) =>
        m.provider?.toLowerCase() === "magpie" && before.encryptedApiKeys[m.id],
    );
    const encryptedApiKey =
      journal?.encryptedApiKey ||
      (source && before.encryptedApiKeys[source.id]);
    if (!encryptedApiKey)
      throw new Error(
        "请先在 DW 保存一个提供商名为 magpie 的模型及密钥（可填本地桥接占位值），再重新开启连接。插件将复用其加密格式同步所有模型。",
      );
    const ids = entries.map((m) => m.id);
    const nextJournal = {
      version: 2,
      config: p.config,
      previousDefault: journal?.previousDefault ?? before.defaultModelId,
      modelIds: [...new Set([...owned, ...ids])],
      encryptedApiKey,
    };
    if (JSON.stringify(journal) !== JSON.stringify(nextJournal))
      atomic(p.journal, nextJournal);
    after.models = [...retained, ...entries];
    for (const id of owned) delete after.encryptedApiKeys[id];
    for (const id of ids) after.encryptedApiKeys[id] = encryptedApiKey;
    // Preserve a DW selection. Pick a default only on first connect or if removed.
    if (
      !journal ||
      (owned.has(before.defaultModelId) && !ids.includes(before.defaultModelId))
    ) {
      const legacy = before.models.find((m) => m.id === before.defaultModelId);
      after.defaultModelId =
        entries.find((m) => m.modelId === legacy?.modelId)?.id || ids[0];
    }
  } else if (journal) {
    after.models = after.models.filter((m) => !owned.has(m.id));
    for (const id of owned) delete after.encryptedApiKeys[id];
    if (owned.has(after.defaultModelId))
      after.defaultModelId = after.models.some(
        (m) => m.id === journal.previousDefault,
      )
        ? journal.previousDefault
        : after.models[0]?.id || "";
  } else return;
  if (JSON.stringify(before) !== JSON.stringify(after))
    checkedWrite(p.config, before, after);
  if (!connection && journal) atomic(p.journal, null);
}
