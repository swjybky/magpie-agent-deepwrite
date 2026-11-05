// Runs inside Magpie's moejs sandbox; no Node APIs or external imports.
export const agent = {
  id: "deepwrite",
  name: "DeepWrite",
  config: "~/.config/magpie-deepwrite/connection.json",
  model: "model",
  bin: "deepwrite",
  dir: "~/.config/magpie-deepwrite",
  ua: ["deepwrite"],
  notice:
    "请先退出 DeepWrite 再切换连接，等待 2 秒后重开。卸载前先关闭本行连接。插件使用本地桥接，需保持 Magpie 运行。",
};

export function connect({ gateway, model }) {
  if (!gateway || !gateway.v1 || !gateway.key || !model || !model.id) {
    throw new Error("DeepWrite needs a Magpie gateway and a selected model.");
  }
  return {
    gateway: gateway.v1,
    key: gateway.key,
    selected: {
      id: model.id,
      name: model.name || model.id,
      context: model.context || 128000,
      output: model.output || 16384,
      efforts: model.efforts || [],
    },
  };
}
