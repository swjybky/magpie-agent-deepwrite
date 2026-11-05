import { read, atomic, checkedWrite } from "./storage.mjs";
export const MODEL_ID = "magpie-deepwrite";

export function connectionAt(path) {
  const value = read(path, null);
  if (!value?.key || !value?.model) return null;
  const url = new URL(value.gateway);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid gateway URL.");
  if (value.selected?.id !== value.model)
    throw new Error("Incomplete model change; waiting for Magpie.");
  return value;
}
export function modelEntry(connection, baseUrl) {
  const selected = connection.selected;
  const contextWindow = Math.max(
    1024,
    Math.min(10000000, Math.trunc(selected.context) || 128000),
  );
  const maxTokens = Math.max(
    1,
    Math.min(contextWindow, 2000000, Math.trunc(selected.output) || 16384),
  );
  const allowed = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const levels = (selected.efforts || []).filter((x) => allowed.includes(x));
  return {
    id: MODEL_ID,
    label: `Magpie · ${selected.name}`.slice(0, 120),
    // DW explicitly supports keyless local Ollama-compatible OpenAI endpoints.
    provider: "ollama",
    api: "openai-completions",
    baseUrl,
    modelId: selected.id,
    reasoning: levels.length > 0,
    defaultThinkingLevel: levels.includes("medium")
      ? "medium"
      : levels[0] || "off",
    thinkingLevelOptions: levels.length ? [...new Set(levels)] : allowed,
    temperatureOptions: [0.1, 0.7, 1],
    contextWindow,
    maxTokens,
    toolSchemaProfile: "portable",
    supportsDeveloperRole: false,
  };
}
export function synchronize(p, connection, baseUrl) {
  const before = read(p.config, null);
  const journal = read(p.journal, null);
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
  const after = structuredClone(before);
  const existing = after.models.find((m) => m.id === MODEL_ID);
  if (connection) {
    if (!journal) {
      if (existing || before.models.length >= 100)
        throw new Error(
          "Dedicated model already exists or the 100-model limit is reached.",
        );
      // Write recovery record before changing DW, surviving crashes between the two writes.
      atomic(p.journal, {
        version: 1,
        config: p.config,
        previousDefault: before.defaultModelId,
      });
    } else if (journal.config !== p.config)
      throw new Error("Disconnect before changing DeepWrite data locations.");
    const entry = modelEntry(connection, baseUrl);
    after.models = [...after.models.filter((m) => m.id !== MODEL_ID), entry];
    after.defaultModelId = MODEL_ID;
  } else if (journal) {
    if (journal.config !== p.config)
      throw new Error("Recovery data location differs from DeepWrite.");
    after.models = after.models.filter((m) => m.id !== MODEL_ID);
    if (after.defaultModelId === MODEL_ID)
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
