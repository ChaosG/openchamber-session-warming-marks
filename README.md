# Session Warming Marks

OpenChamber extension that shows each session's prompt-cache warming state as a flame on its sidebar row.
OpenChamber 扩展：在会话列表每一行用火焰显示提示词缓存的预热状态。

[English](#english) · [中文](#中文)

## States / 状态

| State / 状态 | Color / 颜色 | Icon | Tone | Meaning / 含义 |
|---|---|---|---|---|
| Not warming / 未预热 | ⚪ Hollow / 空心 | `fire` | `neutral` | “Keep this session warm” is off. / 没有开启“保持此会话预热”。 |
| Warming / 预热中 | 🟠 Orange / 橙色 | `fire-fill` | `warning` | Warming requests are being sent. / 正在按间隔发送预热请求。 |
| Waiting / 等待开始 | 🔘 Gray solid / 灰色实心 | `fire-fill` | `neutral` | The session is replying; warming starts when it goes idle. / 会话正在回复，结束后开始预热。 |
| Expired / 已过期 | 🔵 Blue / 蓝色 | `fire-fill` | `info` | The warming window ended; the next reply starts it again. / 预热窗口已过，下次回复后重新开始。 |

Clicking a mark opens this extension's panel. Use the session context menu (**Keep this session warm / Stop warming this session**) to toggle warming.
点击火焰图标会打开扩展面板；切换预热请用会话右键菜单里的“保持此会话预热 / 停止预热此会话”。

---

## English

### Install

1. Open **Settings → Extensions** in OpenChamber.
2. Click **Add** and choose this folder, a ZIP, or the Git URL:
   `https://github.com/ChaosG/openchamber-session-warming-marks.git`
3. Approve the three permissions in the dialog:
   - local service;
   - read OpenCode sessions (read-only, used to list sessions);
   - show marks in the sidebar.
4. Open or refresh a session list. The flame icons appear gradually, about one per second (marks are rate-limited to 60/minute).

Requires OpenChamber `>= 2.7.1` (the `marks` capability ships after 2.7.0).

### How it works

The extension ships a long-running Node service (`service/main.js`, `keepRunning: true`):

- every 5 seconds it reads OpenChamber's `session-warming.json`;
- every 15 seconds it reads the top-level session list from OpenCode's `/api/session`;
- it merges both and calls the host's `setMark({ sessionId }, { icon, tone, text })`;
- only changed marks are sent, avoiding the rate limit.

It does not patch OpenChamber, does not need systemd, and survives OpenChamber upgrades.

### Permissions

- **service**: start a local Node process;
- **opencode**: read-only access to the OpenCode session list (`OPENCHAMBER_OPENCODE_URL`);
- **marks**: draw icons on sidebar rows.

The service does not inherit OpenChamber secrets or the UI password. It only receives `OPENCHAMBER_SERVICE_TOKEN` and the host callback URL.

### Limits

- `mark.icon` accepts only the Remixicon names built into OpenChamber, so a custom dashed flame is not possible. This extension uses `fire` / `fire-fill` plus tone.
- At most two marks per row (one per extension). On one-line rows, hover buttons cover the mark; clicks reach marks on two-line rows and touch screens.
- Marks are not shown on mobile, VS Code, or isolated-space rows.
- At most 200 marks and 60 mark changes per minute; when there are more than 200 sessions, only the 200 most recently active top-level sessions are marked.
- Clicking a mark only opens the panel; it does not toggle warming.

---

## 中文

### 安装

1. 打开 OpenChamber 的 **设置 → 扩展**。
2. 点 **添加**，选择这个文件夹、ZIP，或填 Git URL：
   `https://github.com/ChaosG/openchamber-session-warming-marks.git`
3. 在批准对话框里允许三项权限：
   - 本地服务（service）；
   - 读取 OpenCode 会话（只读，用于拿到会话列表）；
   - 在侧边栏显示 marks。
4. 打开或刷新会话列表。火焰图标会逐步出现，大约每秒一个（marks 限速 60 次/分钟）。

要求 OpenChamber `>= 2.7.1`（`marks` 能力在 2.7.0 之后提供）。

### 工作原理

扩展包含一个常驻 Node 服务（`service/main.js`，`keepRunning: true`）：

- 每 5 秒读取 OpenChamber 的 `session-warming.json`；
- 每 15 秒通过 OpenCode 的 `/api/session` 读取顶层会话列表；
- 合并两边状态，调用宿主 `setMark({ sessionId }, { icon, tone, text })`；
- 只对变化的会话发送 mark，避免触发限速。

不修改 OpenChamber 源码，不需要 systemd，升级 OpenChamber 后扩展仍然保留。

### 权限

- **service**：启动本地 Node 进程；
- **opencode**：只读访问 OpenCode 的会话列表（`OPENCHAMBER_OPENCODE_URL`）；
- **marks**：在侧边栏行显示图标。

服务进程不继承 OpenChamber 的密钥/UI 密码，只拿到 `OPENCHAMBER_SERVICE_TOKEN` 和宿主回调地址。

### 限制

- `mark.icon` 只接受 OpenChamber 内置的 Remixicon 名称，所以不能使用自定义虚线火焰；本扩展用 `fire` / `fire-fill` + tone 区分状态。
- 每行最多显示 2 个 mark（每个扩展一个）；单行行上鼠标悬停时行内按钮会盖住 mark，点击只在两行行或触屏上可达。
- 手机、VS Code、隔离子空间不显示 marks。
- 最多 200 个 mark，marks 变更限速 60 次/分钟；会话超过 200 个时只标记最近活跃的 200 个顶层会话。
- 点击 mark 只会打开面板，不会直接切换预热。

---

## Development / 开发

```bash
node --check service/main.js
node test/mock-test.mjs
```

`test/mock-test.mjs` starts a mock OpenChamber callback and OpenCode session API, then checks the icon, tone and text for all four states.
`test/mock-test.mjs` 会启动 mock 的 OpenChamber 回调和 OpenCode 会话接口，验证四种状态的图标、tone 和文本。

Folder installs are for development: edit `panel/` or `service/`, then reload the extension card. ZIP/Git installs copy the files into OpenChamber's data directory; bump `version` in `package.json` to publish an update.
文件夹安装适合开发：修改 `panel/` 或 `service/` 后重新加载扩展卡片。ZIP/Git 安装会复制文件到 OpenChamber 数据目录，更新时提升 `package.json` 的 `version`。

## Uninstall / 卸载

Settings → Extensions → Remove. The service stops and the marks disappear.
设置 → 扩展 → 移除。服务进程会停止，marks 自动消失。

## License

MIT
