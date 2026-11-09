// Runs inside Magpie's moejs sandbox; no Node APIs or external imports.
export const agent = {
  id: "deepwrite",
  name: "DeepWrite",
  config: "~/.config/magpie-deepwrite/connection.json",
  bin: "deepwrite",
  dir: "~/.config/magpie-deepwrite",
  ua: ["deepwrite"],
  notice:
    "连接信息已写入，插件将自动创建 magpie 分组并同步模型。请退出 DeepWrite，等待 2 秒后重开；实际同步结果见 ~/.config/magpie-deepwrite/status.json。卸载前先关闭连接。",
};
export function connect({ gateway, models, model }) {
  if (!gateway?.v1 || !gateway?.key)
    throw new Error("DeepWrite needs a Magpie gateway.");
  const catalog = models || (model ? [model] : []);
  if (!catalog.length)
    throw new Error("No Magpie models are available to DeepWrite.");
  return {
    catalogVersion: 2,
    gateway: gateway.v1,
    key: gateway.key,
    models: catalog.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context || 128000,
      output: m.output || 16384,
      efforts: m.efforts || [],
      native_endpoints: m.native_endpoints || [],
    })),
  };
}
