import { createHash } from "node:crypto";
export const MODEL_ID = "magpie-deepwrite"; // v0.1.0 migration
export const modelId = (id) =>
  `${MODEL_ID}-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
export function catalog(connection) {
  const models =
    connection.models || (connection.selected ? [connection.selected] : []);
  const ids = new Set();
  return models.map((m) => {
    if (
      !m ||
      typeof m.id !== "string" ||
      !m.id ||
      m.id.length > 240 ||
      ids.has(m.id)
    )
      throw new Error("Invalid or duplicate Magpie model ID.");
    ids.add(m.id);
    return m;
  });
}
export function modelEntry(selected, baseUrl) {
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
    id: modelId(selected.id),
    label: selected.id.slice(0, 120),
    description: (selected.name || selected.id).slice(0, 500),
    provider: "magpie",
    api: selected.native_endpoints?.includes("/v1/responses")
      ? "openai-responses"
      : "openai-completions",
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
