# Mulby × OpenClaw Node 集成指南

Mulby 可作为 [OpenClaw](https://docs.openclaw.ai/nodes) 的 **Node 节点** 运行，让 OpenClaw Agent 远程调用 Mulby 的桌面能力。

---

## 快速开始

### 1. 配置连接

在 **设置 → OpenClaw** 中填写：

| 字段 | 说明 | 示例 |
|:--|:--|:--|
| Gateway 地址 | OpenClaw Gateway 的 IP/域名 | `192.168.31.94` |
| 端口 | Gateway WebSocket 端口 | `18789` |
| Token | Gateway 认证令牌（如已设置） | `abc123...` |
| 节点显示名称 | 在 Gateway 中显示的名称 | `Mulby` |
| TLS | 是否使用加密连接 | 按需开启 |

### 2. 建立连接

点击 **"连接"** 按钮，或开启 **"启动时自动连接"**。

### 3. 首次配对

首次连接时 Gateway 会要求配对确认，在 Gateway 端批准即可。

---

## 支持的命令

### 标准命令

#### `system.run` — 远程执行 Shell 命令

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `command` | string | ✅ | 可执行文件名或命令 |
| `args` | string[] | | 命令参数 |
| `cwd` | string | | 工作目录 |
| `shell` | boolean | | 是否通过 shell 执行（默认 `true`） |
| `timeoutMs` | number | | 超时毫秒（默认 30000） |

**返回格式：**
```json
{
  "exitCode": 0,
  "timedOut": false,
  "success": true,
  "stdout": "hello\n",
  "stderr": "",
  "error": null
}
```

**使用示例：**
```bash
# 执行简单命令
openclaw nodes invoke --node Mulby --command system.run \
  --params '{"command":"echo","args":["hello world"]}'

# 执行 shell 脚本
openclaw nodes invoke --node Mulby --command system.run \
  --params '{"command":"ls","args":["-la","/Applications"],"shell":true}'

# 带超时的命令
openclaw nodes invoke --node Mulby --command system.run \
  --params '{"command":"ping","args":["-c","3","google.com"],"timeoutMs":10000}'
```

> ⚠️ 受 Mulby 安全策略控制（设置 → 命令执行），可配置为"需确认 / 白名单 / 完全允许"。

---

#### `system.notify` — 推送系统通知

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `title` | string | | 通知标题（默认 "OpenClaw"） |
| `body` | string | | 通知内容 |

```bash
openclaw nodes invoke --node Mulby --command system.notify \
  --params '{"title":"提醒","body":"会议将在5分钟后开始"}'
```

---

#### `device.info` — 获取设备信息

无需参数。

```bash
openclaw nodes invoke --node Mulby --command device.info
```

**返回示例：**
```json
{
  "hostname": "MacBook-Pro.local",
  "platform": "darwin",
  "arch": "arm64",
  "osVersion": "24.3.0",
  "appName": "Mulby",
  "appVersion": "0.2.0",
  "nodeVersion": "20.18.3",
  "electronVersion": "34.2.0"
}
```

---

#### `device.status` — 获取设备运行状态

无需参数。

```bash
openclaw nodes invoke --node Mulby --command device.status
```

**返回示例：**
```json
{
  "uptime": 86400,
  "freeMemory": 4294967296,
  "totalMemory": 17179869184,
  "cpuUsage": { "user": 1234567, "system": 567890 },
  "memoryUsage": 52428800,
  "pid": 12345
}
```

---

#### `canvas.snapshot` — 截取屏幕截图

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `format` | `"png"` \| `"jpeg"` | | 图片格式（默认 `png`） |
| `quality` | number | | JPEG 质量 1-100（默认 90） |

**返回格式（Gateway 严格要求）：**
```json
{
  "format": "jpeg",
  "base64": "<纯 base64 字符串，不含 data:image 前缀>"
}
```

```bash
# 截取 PNG 格式
openclaw nodes invoke --node Mulby --command canvas.snapshot

# 截取 JPEG 格式
openclaw nodes invoke --node Mulby --command canvas.snapshot \
  --params '{"format":"jpeg","quality":80}'
```

> 多显示器环境下自动截取主显示器。

---

#### `canvas.present` — 在新窗口展示 URL

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `url` | string | ✅ | 要展示的网页 URL |
| `width` | number | | 窗口宽度（默认 800） |
| `height` | number | | 窗口高度（默认 600） |
| `title` | string | | 窗口标题 |
| `windowId` | string | | 窗口 ID（可复用同一窗口） |

```bash
openclaw nodes invoke --node Mulby --command canvas.present \
  --params '{"url":"https://example.com","width":1024,"height":768,"title":"Preview"}'
```

---

#### `canvas.eval` — 在 Canvas 窗口执行 JavaScript

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `windowId` | string | ✅ | 由 `canvas.present` 返回的窗口 ID |
| `code` | string | ✅ | 要执行的 JavaScript 代码 |

```bash
# 先用 canvas.present 打开一个窗口，拿到 windowId
# 然后在窗口中执行 JS
openclaw nodes invoke --node Mulby --command canvas.eval \
  --params '{"windowId":"canvas-1234","code":"document.title"}'
```

---

### Mulby 自定义命令

以下命令是 Mulby 的独有能力，需在设置中开启对应开关，并在 Gateway 端通过 `gateway.nodes.allowCommands` 允许。

#### `mulby.search` — 搜索本地应用和文件

**开关：** `exposeSearch`

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `query` | string | ✅ | 搜索关键词（支持拼音） |
| `limit` | number | | 最大结果数（默认 20） |

```bash
openclaw nodes invoke --node Mulby --command mulby.search \
  --params '{"query":"微信"}'
```

**返回示例：**
```json
{
  "query": "微信",
  "results": [
    { "name": "微信", "path": "/Applications/WeChat.app", "type": "application" },
    { "name": "微信输入法", "path": "/Library/Input Methods/WeType.app", "type": "application" }
  ]
}
```

---

#### `mulby.plugin.list` — 列出已安装的插件

**开关：** `exposePlugins`

```bash
openclaw nodes invoke --node Mulby --command mulby.plugin.list
```

**返回示例：**
```json
{
  "plugins": [
    { "id": "color-picker", "name": "取色器", "description": "屏幕取色工具", "version": "1.0.0" },
    { "id": "clipboard-history", "name": "剪贴板历史", "description": "管理剪贴板记录", "version": "1.0.0" }
  ]
}
```

---

#### `mulby.plugin.invoke` — 调用插件方法

**开关：** `exposePlugins`

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `pluginId` | string | ✅ | 插件 ID |
| `method` | string | ✅ | 要调用的 feature code |
| `args` | array | | 传入参数（`args[0]` 作为 input） |

```bash
openclaw nodes invoke --node Mulby --command mulby.plugin.invoke \
  --params '{"pluginId":"color-picker","method":"pick"}'
```

---

#### `mulby.clipboard.get` — 获取剪贴板内容

**开关：** `exposeClipboard`

```bash
openclaw nodes invoke --node Mulby --command mulby.clipboard.get
```

**返回示例：**
```json
{
  "text": "Hello World",
  "html": "",
  "hasImage": false
}
```

---

#### `mulby.clipboard.set` — 设置剪贴板内容

**开关：** `exposeClipboard`

| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| `text` | string | ✅ | 要写入的文本 |

```bash
openclaw nodes invoke --node Mulby --command mulby.clipboard.set \
  --params '{"text":"从 OpenClaw 写入的内容"}'
```

---

## 安全策略

在 **设置 → OpenClaw → 安全策略** 中配置：

| 配置项 | 说明 |
|:--|:--|
| **命令执行模式** | `禁止` / `需确认（默认）` / `完全允许` |
| **暴露搜索能力** | 允许 Agent 使用 `mulby.search` |
| **暴露插件能力** | 允许 Agent 使用 `mulby.plugin.*` |
| **暴露剪贴板** | 允许 Agent 使用 `mulby.clipboard.*` |

> ⚠️ 自定义命令除了在 Mulby 端开启开关外，还需在 Gateway 端通过 `gateway.nodes.allowCommands` 将命令加入白名单。

---

## Gateway 端配置

```bash
# 查看当前节点
openclaw nodes list

# 允许自定义命令（在 Gateway 端执行）
openclaw config set gateway.nodes.allowCommands '[
  "mulby.search",
  "mulby.plugin.list",
  "mulby.plugin.invoke",
  "mulby.clipboard.get",
  "mulby.clipboard.set"
]'
```

---

## 调试

Mulby 内置了 OpenClaw 日志面板（设置 → OpenClaw → 日志），实时显示：

- 连接/断连事件
- 握手过程
- 命令调用请求和响应
- 错误信息

日志面板支持展开详情、按级别着色、一键清空。

---

## 连接机制

| 特性 | 说明 |
|:--|:--|
| **协议** | WebSocket（v3 协议） |
| **认证** | Ed25519 签名 + 设备配对 |
| **自动重连** | 断线后指数退避重连（3s → 30s） |
| **热更新** | 安全策略变更即时生效，无需重连 |
| **TLS** | 可选 wss:// 加密传输 |

---

## 架构概览

```
OpenClaw Agent / CLI
        │
        ▼
  ┌─────────────┐
  │   Gateway    │  ← 命令路由 + 认证 + 白名单
  └─────┬───────┘
        │ WebSocket (ws / wss)
        ▼
  ┌─────────────┐
  │    Mulby     │  ← OpenClaw Node
  │  (Desktop)   │
  ├─────────────┤
  │ system.*    │  shell 命令、系统通知
  │ device.*    │  设备信息、运行状态
  │ canvas.*    │  截屏、展示网页、执行 JS
  │ mulby.*     │  搜索、插件、剪贴板（自定义）
  └─────────────┘
```
