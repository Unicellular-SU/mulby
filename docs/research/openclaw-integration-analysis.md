# Mulby × OpenClaw 整合可行性分析

> 撰写时间：2026-03-22
> 基于：OpenClaw docs (docs.openclaw.ai) + Mulby v0.2.0 架构

---

## 1. 两者定位对比

| 维度 | OpenClaw 🦞 | Mulby 🧰 |
|------|------------|-----------|
| **核心定位** | 自托管多通道 AI Agent 网关 | 跨平台桌面效率工具箱 |
| **运行形态** | Node.js CLI daemon | Electron 桌面应用 |
| **AI 角色** | AI 是核心（Agent 驱动一切） | AI 是辅助能力（`mulby.ai` Skills） |
| **用户交互** | 聊天通道（WhatsApp/Telegram/Discord 等 20+） | 全局快捷键唤起桌面 UI |
| **扩展机制** | Skills + Plugins + Tools | 插件系统（React UI 插件 + AI function-calling） |
| **协议** | WebSocket JSON 帧 (Gateway Protocol v3) | Electron IPC + preload APIs |

---

## 2. 核心方案：Mulby 作为 OpenClaw Node（方案 B）

### 2.1 OpenClaw Node 是什么

Node 是 OpenClaw 架构中的**能力主机（capability host）**。它不运行 Gateway/AI 模型，而是作为外围设备连接到 Gateway，暴露以下能力供 Agent 远程调用：

| 命令族 | 能力 | Mulby 对应能力 |
|--------|------|---------------|
| `system.run` | 在远程机器执行 shell 命令 | ✅ Electron `child_process` |
| `system.notify` | 推送系统通知 | ✅ Electron `Notification` |
| `canvas.snapshot` | 截屏 | ✅ Electron `desktopCapturer` |
| `canvas.present/navigate/eval` | 展示/控制网页界面 | ✅ Electron `BrowserWindow` |
| `canvas.a2ui` | Agent-to-UI 推送内容 | ⚡ 可通过插件 UI 实现 |
| `location.get` | 获取位置 | ✅ 已有 `electron-get-location` |
| `device.info/status` | 设备信息 | ✅ Electron `app`/`os` 模块 |
| `notifications.list` | 查询通知 | ⚠️ 需额外实现 |
| **自定义命令** | 调用 Mulby 插件 | ⭐ **核心增值点** |

### 2.2 协议交互流程

Mulby 作为 Node 连接到 OpenClaw Gateway 的完整流程：

```
┌──────────┐                    ┌──────────────────┐
│  Mulby   │   WebSocket        │  OpenClaw        │
│  (Node)  │◄──────────────────►│  Gateway         │
└──────────┘   JSON frames      └──────────────────┘
                                       ▲
                                       │ chat messages
                               ┌───────┴───────┐
                               │  Telegram /    │
                               │  WhatsApp /    │
                               │  Discord ...   │
                               └────────────────┘
```

**握手流程**：
```
1. Mulby → Gateway: connect { role: "node", caps, commands, permissions, auth }
2. Gateway → Mulby: hello-ok { protocol: 3, deviceToken }  // 或要求 pairing
3. Gateway → Mulby: invoke { command: "system.run", params: {...} }
4. Mulby → Gateway: invoke-res { ok: true, payload: {...} }
5. 心跳: tick 每 15s
```

**Gateway Protocol 帧格式**：
- Request: `{type: "req", id, method, params}`
- Response: `{type: "res", id, ok, payload|error}`
- Event: `{type: "event", event, payload}`

### 2.3 Mulby 可以暴露的自定义命令（核心亮点）

除了标准 Node 命令外，Mulby 可以注册**自定义 commands**，让 OpenClaw Agent 直接调用 Mulby 的插件生态：

```typescript
// 在 connect 握手时声明支持的 commands
{
  commands: [
    // 标准 Node 命令
    "system.run",
    "system.notify", 
    "canvas.snapshot",
    "device.info",
    
    // ⭐ Mulby 自定义命令
    "mulby.plugin.list",          // 列出已安装的插件
    "mulby.plugin.invoke",        // 调用指定插件
    "mulby.search",               // 搜索功能
    "mulby.clipboard.get",        // 获取剪贴板
    "mulby.clipboard.set",        // 设置剪贴板
    "mulby.ai.chat",              // 使用 Mulby 的 AI Skills
  ],
  caps: ["system", "canvas", "mulby"],
  permissions: {
    "system.run": true,
    "canvas.snapshot": true,
    "mulby.plugin": true,
  }
}
```

**用户场景示例**：
- 📱 用户在 Telegram 上对 OpenClaw 说："帮我用 Mulby 的 JSON 格式化插件处理一下这段数据"
- 🤖 OpenClaw Agent → 调用 `mulby.plugin.invoke { plugin: "json-formatter", action: "format", data: "..." }`
- 💻 Mulby Node 执行插件 → 返回结果给 Agent → Agent 回复到 Telegram

### 2.4 安全策略

遵循 OpenClaw 的 exec-approvals 安全模型：

| 策略 | 说明 | 推荐 |
|------|------|------|
| `security: "deny"` | 拒绝所有 exec | 默认值（最安全） |
| `security: "allowlist"` | 仅允许白名单命令 | ✅ 推荐用于生产 |
| `security: "full"` | 允许所有命令 | ⚠️ 仅测试用 |
| `ask: "on-miss"` | 白名单未命中时弹窗询问 | ✅ 推荐 |
| `ask: "always"` | 每次都弹窗询问 | 安全要求高场景 |

Mulby 可在 **Settings → OpenClaw** 中提供可视化的 approval 管理界面，比 headless node host（用 JSON 文件管理）体验更好。

---

## 3. 实现架构设计

### 3.1 模块结构

```
src/main/openclaw/
├── index.ts                    // 模块入口与注册
├── node-client.ts              // WebSocket 客户端（Gateway Protocol）
├── command-handlers/
│   ├── system.ts               // system.run / system.notify / system.which
│   ├── canvas.ts               // canvas.snapshot / canvas.present / canvas.eval
│   ├── device.ts               // device.info / device.status
│   ├── location.ts             // location.get
│   └── mulby-custom.ts         // mulby.plugin.* / mulby.search / mulby.clipboard
├── security/
│   ├── exec-approvals.ts       // 执行审批策略
│   └── approval-dialog.ts      // UI 审批弹窗
├── config.ts                   // 连接配置管理
└── types.ts                    // 协议类型定义
```

### 3.2 核心技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| WebSocket 客户端 | Node.js 原生 `ws` 或 Electron 内置 | 零依赖，与 Gateway Protocol 的 JSON 帧格式对齐 |
| 配置存储 | 复用 Mulby 已有的 settings store | 与 Mulby 设置体系统一 |
| Exec 审批 | 自建 approval dialog | Electron dialog + Mulby UI 风格一致 |
| 插件调用 | 复用 `internal-tool-runtime.ts` | Mulby 已有 AI tool-calling 基础设施 |

### 3.3 实现分期

#### Phase 1: 基础连接（MVP）
- WebSocket 连接 Gateway
- connect 握手 + device pairing
- 支持 `system.run` + `system.notify`
- Settings UI 配置连接参数（host/port/token）
- 基于 allowlist 的 exec-approvals

#### Phase 2: Canvas + Device
- `canvas.snapshot`（截屏）
- `canvas.present / navigate / eval`（Web 控制）
- `device.info / device.status`
- `location.get`

#### Phase 3: Mulby 自定义命令（核心差异化）
- `mulby.plugin.list / invoke`（远程调用 Mulby 插件）
- `mulby.search`（远程搜索）
- `mulby.clipboard.*`（剪贴板操作）
- `mulby.ai.chat`（远程使用 Mulby 的 AI Skills）

#### Phase 4: 高级功能
- 双向角色：同时作为 Node + Operator（可在 Mulby 内发消息给 Agent）
- Approval forwarding（审批转发到聊天通道）
- 自动重连 + 断线恢复
- OpenClaw Plugin 形态发布（作为 npm 包，可被其他 OpenClaw 用户安装）

---

## 4. 与现有架构对齐

### 4.1 已确认 Mulby 已实现的能力

- ✅ **AI function-calling**：`internal-tools.ts` + `internal-tool-runtime.ts` 已实现 AI 自主调用插件（方案 C1 已落地）
- ✅ **MCP 集成**：`src/main/ai/mcp/service.ts` 已支持 MCP 协议
- ✅ **位置服务**：`electron-get-location` 已集成
- ✅ **任务调度**：`src/main/scheduler/` 已有 Cron 调度能力
- ✅ **系统通知**：Electron Notification API 已可用

### 4.2 全新能力

- 🆕 **OpenClaw Gateway Protocol 客户端**
- 🆕 **Exec Approvals 审批机制**
- 🆕 **Canvas 远程控制**
- 🆕 **"mulby.plugin.invoke" 自定义命令桥接**

---

## 5. 潜力分析：为什么 Mulby-as-Node 很有价值

### 5.1 跨平台优势
OpenClaw 官方的 Node 生态主要覆盖：
- 📱 macOS/iOS 原生 app（Mac Node Mode）
- 📱 Android app
- 💻 Headless node host（CLI）

**Mulby 可以填补的空白**：
- 🪟 **Windows 桌面 Node**（OpenClaw 没有 Windows 原生 companion app）
- 🐧 **Linux 桌面 Node**（同上）
- 🖥️ **带 UI 的 Node**（现有 headless node host 无 UI，approval 体验差）

### 5.2 生态扩展
- Mulby 的**插件生态**可作为 OpenClaw 的**远程工具集**
- 用户在 Telegram 上就能使用"JSON 格式化""时间戳转换""Base64 编码"等 Mulby 插件
- OpenClaw 的 Agent 获得了**桌面 GUI 操控能力**（canvas.present 由 Electron BrowserWindow 实现）

### 5.3 商业化机会
- Mulby 可以作为 OpenClaw 生态中的"**桌面伴侣应用**"进行推广
- 反过来，OpenClaw 社区用户也会了解到 Mulby 这个效率工具

---

## 6. 风险与建议

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| OpenClaw 仍在快速迭代，协议可能变化 | 兼容性问题 | 关注 `PROTOCOL_VERSION`，做好版本协商 |
| 安全审计复杂度 | remote exec 安全 | 默认 `security: deny`，渐进式开放 |
| 用户需要自行部署 Gateway | 使用门槛 | 提供一键连接向导 + 清晰文档 |
| OpenClaw 社区规模尚待观察 | 投入产出比 | Phase 1 轻量实现，验证需求后深入 |

### 建议实施优先级
1. **Phase 1 先行**：基础连接 + system.run + Settings UI，约 3-5 天工作量
2. **社区验证**：与 OpenClaw 团队沟通，确认 Protocol 稳定性，探讨官方合作
3. **按需推进**：基于用户反馈决定 Phase 2-4 的优先级
