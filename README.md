# DeepWrite for Magpie

在 Magpie 的 Agent 页面给 **DeepWrite** 选模型、打开连接，即可通过 Magpie 网关写作。独立插件，无需修改 DeepWrite 源码。

## 安装与使用

1. 在 Magpie → 插件 → 发现，搜索 **DeepWrite**，选择「非官方插件 · GitHub」中的 `swjybky/magpie-agent-deepwrite`。
2. 如果搜索索引尚未更新，在添加插件输入框粘贴 `github:swjybky/magpie-agent-deepwrite`，点击安装。
3. 先打开过一次 DeepWrite，让它创建模型配置；**退出 DeepWrite**。
4. 在 Magpie → Agent → **DeepWrite** 选择一个 Magpie 模型，开启连接，等待约 2 秒。
5. 重开 DeepWrite，使用 **Magpie · 模型名称**。已有作品或团队绑定了其他模型时，在 DW 的模型选择器改选这个模型。

Magpie 必须保持运行。首次加载插件时，Magpie 自己下载和管理 Bun，无需手动安装运行时。Windows / Linux 的实现已包含，但目前只在 macOS 验证；建议先备份模型配置再使用。

也可以用命令行安装（确保 Magpie 应用保持运行）：

```sh
magpie plugin add github:swjybky/magpie-agent-deepwrite
```

这是第三方插件，不带「magpie 社区」认证。无需登录额外服务，使用你已经在 Magpie 配好的提供商和模型。

## 切换与断开

切换模型前先退出 DW，在 Magpie 更换模型，等待 2 秒再重开 DW。关闭连接时也执行相同顺序。插件移除自己的模型，并恢复原来的默认模型；其他模型、密钥及使用期间新增的配置保留。**卸载插件前先关闭 DeepWrite 这一行的连接**。

如果 DW 运行期间修改模型配置，它可能与外部同步竞争，所以请按上述顺序操作。插件不会替换正在运行的团队所绑定的模型，也不会自动中断正在生成的内容。

## 工作方式与权限

- `deepwrite.agent.js` 在 Magpie 的 moejs 沙盒声明 Agent，并接收它为 DeepWrite 分配的专用网关 key。
- `index.mjs` 在 Magpie 的 Bun 插件宿主内启动仅监听 `127.0.0.1` 随机端口的桥接服务。它只转发 OpenAI Chat Completions；Magpie 负责转换实际提供商协议。
- DW 使用已有的免密钥 Ollama 兼容通道，因此提供商字段显示 `ollama`，模型名称显示 `Magpie · …`。实际请求发给 Magpie，**无需安装 Ollama**。
- 桥接地址带随机能力令牌，拒绝浏览器 Origin / Fetch Metadata 请求；网关鉴权在桥接内完成。请求、正文和凭据不会写入日志。
- DW 的 `encryptedApiKeys` 保持原样，不读取系统钥匙串，不向 DW 写入明文 API Key。
- 专用模型 ID 为 `magpie-deepwrite`；同名冲突、超过 100 个模型、不支持的配置版本会拒绝写入。
- 配置以临时文件 + fsync + 原子重命名保存；恢复记录先于模型配置写入。它不与 DW 内部保存共享事务锁，因此要求在 DW 退出时切换。
- CLI 和 GUI 的插件宿主通过本地租约避免同时改写 DW。

本插件只支持 DW `models.json` **version 3**（按 DeepWrite 1.8.0 源码核对）。不适用旧版配置。

## 配置路径

桥接文件统一在 `~/.config/magpie-deepwrite/`：

| 文件              | 用途                                                |
| ----------------- | --------------------------------------------------- |
| `connection.json` | Magpie 管理的网关、所选模型和专用 key，属于敏感文件 |
| `journal.json`    | 接入前默认模型与目标配置路径，用于恢复              |
| `status.json`     | 当前连接状态或错误，不含 key                        |
| `runtime.lock/`   | 插件宿主租约                                        |

DW 默认目录：

- macOS：`~/Library/Application Support/@deepwrite/desktop`，兼容 `~/Library/Application Support/DeepWrite`。
- Windows：`%APPDATA%/@deepwrite/desktop`，兼容 `%APPDATA%/DeepWrite`。
- Linux：`$XDG_CONFIG_HOME/@deepwrite/desktop` 或 `~/.config/@deepwrite/desktop`，兼容 `DeepWrite`。

自动读取 DW 的 `.desktop.storage-location.json` / `.DeepWrite.storage-location.json` 存储迁移指针。自定义配置可在**启动 Magpie 前**设置 `DEEPWRITE_USER_DATA_PATH`，值为包含 `config/models.json` 的 DW 数据目录。

## 故障恢复

正常关闭连接或 Magpie 正常终止宿主会恢复配置。断电、强制结束进程可能留下专用模型；下次启动插件会恢复同步。需要彻底清理时，先关闭 Magpie 与 DW，再在下载的插件目录执行：

```sh
node scripts/disconnect.mjs
```

如果安装于自定义 DW 数据目录，执行恢复命令时同样设置 `DEEPWRITE_USER_DATA_PATH`。请勿手动删除恢复记录后再执行恢复。

看不到模型时检查 `~/.config/magpie-deepwrite/status.json` 和 Magpie 插件错误信息。连接状态是异步的：Agent 开关反映 Magpie 已写入连接信息，`status.json` 反映 DW 配置是否已同步。

## 开发与验证

```sh
npm test
BUN_BIN=/path/to/bun npm test
```

无运行时依赖，无安装脚本或构建步骤，GitHub 源码可直接安装。测试包含配置保存与恢复、切换、密文保留、冲突拒绝、迁移路径、SSE 转发、鉴权、错误路径，以及 Bun 宿主的连接/断开/SIGTERM 恢复。Bun 集成测试需要显式提供 `BUN_BIN`；未提供时报告跳过。

已在本机 Magpie 0.1.2945 的隔离配置中实际加载，并确认 Agent 列表出现 DeepWrite。尚未执行真实付费模型的写作验收；测试使用独立配置与本地模拟网关。

依据：[Magpie Agent 插件规范](https://usemagpie.ai/docs/zh/plugins#agents) · [GitHub 发布与发现](https://usemagpie.ai/docs/zh/plugins#publish)。

MIT License.
