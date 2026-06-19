# 插件验证（让 AI / 开发者用 Mulby 检查插件）

> 目标：打通插件开发的「最后一公里」——AI 写完插件后，能让 Mulby **实际加载并冒烟测试**该插件，拿到结构化报告，据此判断对错并返工，而不是只能口头说「我没法测」。

这是 **Tier 1 MVP**：覆盖「能不能加载、触没触发、有没有当场报错」这类 80% 的常见翻车场景。UI 渲染深度验证、交互式 MCP 闭环属于 Tier 2（见末尾）。

---

## 一、核心机制：验证模式

Mulby 主进程检测到环境变量 `MULBY_VERIFY_PLUGIN=<插件目录>` 时进入「验证模式」：

1. **隔离 `userData`**：切到临时目录，避免与用户正在运行的 Mulby 抢占单实例锁、或锁住其 SQLite 数据库；同时跳过 `mulby://` 协议注册，不污染系统。
2. **不启动正常 UI / 服务**：不开主窗口、托盘、全局热键、后台插件恢复、任务调度、frecency 预热等。
3. **加载并冒烟测试目标插件**：见下方检查项。
4. **打印报告并退出**：把 `VerifyReport`（JSON）打印到 stdout，包裹在标记之间，然后销毁 host 进程并以退出码 `0`（通过）/ `1`（未通过）退出。

可选环境变量：

- `MULBY_VERIFY_STRICT=1`：严格模式，`warn` 也判失败。

### stdout 输出协议

报告是包裹在以下标记之间的**单行 JSON**（便于在日志噪声中稳定提取，取最后一对标记）：

```
<<<MULBY_VERIFY_REPORT_BEGIN>>>
{...VerifyReport JSON...}
<<<MULBY_VERIFY_REPORT_END>>>
```

标记与类型定义见 `src/shared/types/plugin-verify.ts`。

---

## 二、检查项（Tier 1）

| 检查 | 说明 |
| --- | --- |
| `manifest` | manifest 解析、必需字段、入口文件存在、平台兼容（失败时给出可读原因） |
| `load` | 插件成功注册到 PluginManager |
| `ui-asset` | 声明 `ui` 时，UI 文件存在 |
| `onload` | 有后台 `main` 入口时触发 `onLoad`；**onLoad 抛错会被准确捕获**（区别于正常运行时 onLoad 异常会被吞掉） |
| `trigger:<feature>` | 对每个有 keyword 触发的功能，搜索该关键词并确认能命中该功能（AI 最常配错触发词） |
| `run:<feature>` | 对静默/后台功能实际执行一次；UI 功能在 headless MVP 暂跳过渲染验证 |

总判定 `ok`：无 `fail` 即通过；strict 模式下有 `warn` 也判失败。

---

## 三、在本仓库中使用

```bash
# 1) 构建主进程产物（产生 dist/main/index.js 与 dist/worker/*）
pnpm build:bundle

# 2) 验证插件目录（人类可读输出）
pnpm verify:plugin <插件目录>

# 机器可读 JSON：
pnpm verify:plugin <插件目录> --json

# 严格模式 / 自动构建：
pnpm verify:plugin <插件目录> --strict
pnpm verify:plugin <插件目录> --build

# 保留隔离的临时 userData 目录（默认运行后自动清理）便于排查：
pnpm verify:plugin <插件目录> --keep-userdata
```

> 隔离的临时 `userData` 目录（报告 `meta.userDataDir`）会在进程退出前关闭 SQLite 并删除；
> 驱动脚本在子进程退出后再兜底清理一次。`--keep-userdata` 可保留它。

驱动脚本 `scripts/verify-plugin.mjs` 默认使用仓库内 electron + `dist/main/index.js`。
也可指定已安装的 Mulby：`--app-path <可执行文件>`（或环境变量 `MULBY_APP_PATH`）。

### 自检（夹具）

```bash
pnpm build:bundle
pnpm verify:plugin test/fixtures/plugins/verify-hello
```

预期 onLoad / 触发匹配 / 执行均通过。

---

## 四、PluginManager 验证 API

供验证模式（及未来的 MCP 层）复用，位于 `src/main/plugin/manager.ts`：

- `loadPluginForVerification(dir)` — 加载并注册单个外部目录的插件（仅内存，预热并同步搜索 worker，不产生正常启动副作用）。
- `verifyTriggerOnLoad(plugin)` — 直接驱动 host 触发 `onLoad`，**错误向上抛出**（不被吞掉）。
- `verifyRunFeature(plugin, featureCode, input)` — 直接驱动 host 执行某功能，错误向上抛出。
- `subscribeHostDiagnostics(handler)` — 订阅 host 的 console / error / exit 诊断事件，返回取消订阅函数。

---

## 五、通过 `mulby-cli` 使用（已实现）

`mulby-cli`（`github.com/Unicellular-SU/mulby-cli`）已内置 `mulby verify` 与 `mulby mcp` —— 它们是对本引擎的
薄封装：定位已安装的 Mulby 可执行文件、带环境变量拉起、解析 stdout 中标记包裹的 JSON 报告。

```bash
# 一次性配置：指向已安装的 Mulby 可执行文件（也可用 --app-path 或环境变量 MULBY_APP_PATH）
mulby config set appPath "<Mulby 可执行文件>"

# 验证插件（默认当前目录，也可传目录）
mulby verify
mulby verify ./my-plugin --json
mulby verify ./my-plugin --strict

# 启动交互式 MCP server（Streamable HTTP），打印连接 URL 与 AI IDE 配置，前台常驻
mulby mcp
mulby mcp --port 39127 --token <token>
```

底层契约（供其它集成参考）：输入环境变量 `MULBY_VERIFY_PLUGIN=<目录>`（或 `MULBY_VERIFY_MCP=1`），
输出 stdout 中包裹在 `<<<MULBY_VERIFY_REPORT_BEGIN>>>` / `<<<MULBY_VERIFY_REPORT_END>>>` 之间的单行 JSON 报告。

> 已安装的 Mulby 需包含本特性（验证模式分支）才能响应这些环境变量。

---

## 六、给 AI 的使用建议

插件写完后，运行 `mulby verify <目录> --json`（或本仓库内 `pnpm verify:plugin <目录> --json`），读取 JSON 报告：

1. 任何 `fail` 都要修复后重跑；
2. `onload`/`run` 失败优先看 `logs` 里的 `host` 错误输出；
3. `trigger:*` 失败几乎都是 `manifest.json` 的 `features[].cmds` 触发词配置问题；
4. 反复迭代直到 `ok: true`。

---

## 七、Tier 2：UI 渲染验证 与 MCP 闭环（已实现）

### UI 渲染验证（已并入一次性报告）

对 UI 功能（声明 `ui` 且功能 `mode !== 'silent'`），验证器会在隐藏的 BrowserWindow 中以插件真实 preload
离屏渲染 `manifest.ui`，等待 dom-ready / did-finish-load，采集渲染进程的 console 错误、加载失败与崩溃，
写入报告的 `render:<feature>` 检查与 `features[].uiRender`。

为让插件 UI 挂载不产生「宿主桥缺失」的误报，验证器会注册一组依赖轻量、插件 UI 挂载常用的最小 IPC
处理器（theme / settings / storage / plugin 等）。未注册渠道产生的「No handler registered」会被降级为
非致命的 `missingBridge` 计数（与插件自身错误区分）。

> 残留风险：若插件 UI 在挂载时调用了未注册的宿主能力且未自行兜底，可能产生少量误报；这类信息会出现在
> `missingBridge` / `logs` 中供甄别。深层窗口控制类 API（如 `window.hide`）在 headless 下本就静默无效。

### MCP 闭环（交互式自动化）

环境变量 `MULBY_VERIFY_MCP=1` 让 Mulby 在隔离的 headless 进程中运行一个 MCP server，
暴露以下工具，让 AI 边改插件边驱动 Mulby 检查：

| 工具 | 作用 |
| --- | --- |
| `load_plugin {dir}` | 加载插件目录，返回信息与功能列表 |
| `list_features` | 列出当前插件功能 |
| `search {query}` | 驱动搜索，验证触发词配置 |
| `run {featureCode, input?}` | 执行功能（静默直连 host / UI 离屏渲染） |
| `render_ui {featureCode?, route?}` | 离屏渲染 UI，返回就绪 / 错误 / 页面概要 |
| `screenshot {featureCode?, route?}` | 渲染并截图，返回 PNG 图片 |
| `query_dom {selector? \| js?}` | 渲染并查询 DOM |
| `get_logs {limit?}` | 最近的 host 诊断日志 |

**传输：Streamable HTTP（非 stdio）。** Electron 主进程的 stdin 无法可靠承载 MCP 帧、stdout 也有杂散输出，
因此与 Mulby 自身的 MCP server 一致走本机 HTTP：服务绑定 `127.0.0.1` 的随机端口（或用 `MULBY_VERIFY_MCP_PORT`
固定），并把实际地址写入 stderr（`MULBY_VERIFY_MCP_URL=...`）与 `MULBY_VERIFY_MCP_PORTFILE` 指定的 JSON 文件
（`{ url, userData, token }`）。

鉴权：默认仅绑定 127.0.0.1、无 token（本机开发场景，启动时会 warn）；设置 `MULBY_VERIFY_MCP_TOKEN` 后要求
`Authorization: Bearer <token>`。

**给 AI IDE（Claude Code / Cursor 等）配置**（Streamable HTTP MCP server）：先用固定端口启动验证模式，
再把客户端指向该 URL：

```bash
# 启动（固定端口，可选 token）
MULBY_VERIFY_MCP=1 MULBY_VERIFY_MCP_PORT=39127 \
  <electron 可执行文件> <dist/main/index.js>   # 或直接运行已安装的 Mulby 可执行文件
```

```json
{
  "mcpServers": {
    "mulby-verify": { "url": "http://127.0.0.1:39127/mcp" }
  }
}
```

> 已安装的 Mulby 需包含本特性才能响应 `MULBY_VERIFY_MCP`。客户端用 Streamable HTTP 连接（如
> `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport`），可参考 `scripts/test-mcp-verify.mjs`。

**端到端自测**：

```bash
pnpm build:bundle
node scripts/test-mcp-verify.mjs   # 覆盖静默插件 load/search/run + UI 插件 render/query_dom/screenshot
```

### 仍可继续的方向

- onLoad / UI dom-ready 的**显式成功信号**（host-manager / panel-window 增补），进一步丰富报告。

（`mulby verify` / `mulby mcp` 子命令已在外部 `mulby-cli` 落地。）
