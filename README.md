# Session Warming Marks

OpenChamber extension that shows the prompt-cache warming state of every session as a flame icon on its sidebar row.

| 状态 | 图标 | tone | 含义 |
|---|---|---|---|
| 未预热 | `fire`（空心） | `neutral` | 没有开启“保持此会话预热” |
| 预热中 | `fire-fill`（实心） | `warning` | 正在按间隔发送预热请求 |
| 等待开始 | `fire-fill`（实心） | `neutral` | 会话正在回复，结束后开始预热 |
| 已过期 | `fire-fill`（实心） | `info` | 预热窗口已过，下次回复后重新开始 |

点击火焰图标会打开扩展面板（状态说明）。切换预热请用会话右键菜单里的“保持此会话预热 / 停止预热此会话”。

## 安装

1. 打开 OpenChamber 的 **设置 → 扩展**；
2. 点 **添加**，选择这个文件夹（或打包后的 ZIP）；
3. 在批准对话框里允许：
   - 本地服务（service）
   - 读取 OpenCode 会话（只读，用于拿到会话列表）
   - 在侧边栏显示 marks
4. 打开或刷新一个会话列表，火焰图标会逐步出现（每个图标间隔约 1 秒，受 60 次/分钟的限制）。

要求 OpenChamber `>= 2.7.1`（`marks` 能力在 2.7.0 之后提供）。

## 工作原理

扩展包含一个常驻的 Node 服务（`service/main.js`，`keepRunning: true`）：

- 每 5 秒读取 OpenChamber 的 `session-warming.json`（跨平台探测路径：服务数据目录向上、`~/.config/openchamber`、macOS Application Support、Windows `%APPDATA%`）；
- 每 15 秒通过 OpenCode 的 `/api/session` 读取顶层会话列表；
- 合并两边状态，调用宿主 `setMark({ sessionId }, { icon, tone, text })`；
- 只对变化的会话发送 mark，避免触发速率限制。

不修改 OpenChamber 源码、不需要 systemd，升级 OpenChamber 后扩展仍然保留。

## 权限

- **service**：启动本地 Node 进程；
- **opencode**：只读访问 OpenCode 的会话列表（`OPENCHAMBER_OPENCODE_URL`）；
- **marks**：在侧边栏行显示图标。

服务进程不继承 OpenChamber 的密钥/UI 密码，只拿到 `OPENCHAMBER_SERVICE_TOKEN` 和回调地址。

## 限制

- `mark.icon` 只接受 OpenChamber 内置的 Remixicon 名称，所以不能使用自定义虚线火焰；本扩展用 `fire`/`fire-fill` + tone 区分状态。
- 每行最多显示 2 个 mark（每个扩展一个）；鼠标悬停在单行行上时行内按钮会盖住 mark，点击只在两行行或触屏上可达。
- 手机、VS Code、隔离子空间不显示 marks。
- 最多 200 个 mark，marks 变更限速 60 次/分钟；会话超过 200 个时只标记最近活跃的 200 个顶层会话。
- 点击 mark 只会打开面板，不会直接切换预热——切换仍走原生菜单。

## 开发与测试

```bash
cd openchamber-session-warming-marks
node --check service/main.js
node test/mock-test.mjs
```

`test/mock-test.mjs` 会启动 mock 的 OpenChamber 回调和 OpenCode 会话接口，验证四种状态的图标、tone 和文本。

文件夹安装适合开发：修改 `panel/` 或 `service/` 后在扩展卡片上重新加载即可。ZIP/Git 安装会把文件复制到 OpenChamber 数据目录，更新时提升 `package.json` 的 `version`。

## 卸载

设置 → 扩展 → 移除。服务进程会停止，marks 自动消失。
