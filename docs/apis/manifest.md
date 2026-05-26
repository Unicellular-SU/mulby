# Plugin Manifest (manifest.json) 配置指南

`manifest.json` 是 Mulby 插件的核心配置文件，它定义了插件的基本信息、运行模式、触发指令以及各种高级配置。以下是 `manifest.json` 支持的所有字段详细说明。

## 顶层配置 (PluginManifest)

| 字段名 | 类型 | 是否必填 | 描述 |
| --- | --- | --- | --- |
| `name` | `string` | **是** | 插件内部名称/文件夹名，通常只包含小写字母中划线。 |
| `version` | `string` | **是** | 插件版本号，通常遵循 Semantic Versioning (x.y.z)。 |
| `displayName` | `string` | **是** | 插件在用户界面（如插件商城、搜索列表）中显示的名称。 |
| `description` | `string` | **是** | 插件的功能描述。 |
| `main` | `string` | **是** | 后端主进程的入口文件路径（如 `dist/main.js`）。 |
| `features` | `PluginFeature[]` | **是** | 插件提供的功能和触发入口数组。 |
| `id` | `string` | 否 | 全局唯一标识符（推荐格式：`@scope/name` 或 `com.example.name`）。未提供时以 `name` 作为 ID。 |
| `type` | `PluginType` | 否 | 插件类别。可选值: `utility`, `productivity`, `developer`, `system`, `media`, `network`, `ai`, `entertainment`, `other`。 |
| `author` | `string` | 否 | 插件作者信息。 |
| `homepage` | `string` | 否 | 插件主页或代码仓库地址。 |
| `platform` | `string` \| `string[]` | 否 | 平台限制。缺省则代表全平台。可选受限值: `darwin`, `win32`, `linux`。如 `["win32", "linux"]`。 |
| `ui` | `string` | 否 | 前端渲染进程入口（UI 文件，如 `ui/index.html`）。如果不填则属于纯后台类插件。 |
| `preload` | `string` | 否 | 指定 Preload 脚本文件路径，用于连接 Node.js 与前端（必须是 CommonJS 的 `.cjs` 后缀）。 |
| `assets` | `string[]` | 否 | 打包时额外包含的插件内文件或目录。多 HTML 辅助窗口、额外 preload、`.node` 原生模块、外部二进制等需要显式列入。 |
| `icon` | `PluginIcon` | 否 | 插件的图标，路径或数据等。参考下方“图标配置”。 |
| `permissions` | `object` | 否 | 插件向系统申请的特殊权限。例如 `{ "commandExecution": { "direct": { "enabled": true } }, "screen": true, "clipboard": true }`。 |
| `tools` | `PluginToolSchema[]`| 否 | 给 AI Agent 提供的工具注册声明。 |
| `window` | `WindowOptions` | 否 | 独立窗口配置。 |
| `pluginSetting` | `PluginSetting` | 否 | 插件底层的常规与运行行为配置。 |

---

## 打包资源 (assets)

`assets` 是 Mulby CLI 打包白名单。`manifest.main`、`manifest.ui`、`manifest.preload` 和默认 `ui/` 目录会按规则打包；除此之外的旧插件兼容资源应显式列入 `assets`。

```json
{
  "ui": "ui/index.html",
  "preload": "preload.cjs",
  "assets": [
    "region",
    "effect",
    "recorder",
    "countdown.html",
    "region/preload.cjs",
    "addon-darwin-arm64.node",
    "bin/aperture"
  ]
}
```

常见需要列入 `assets` 的资源包括：通过 `window.mulby.window.create(path, { loadMode: 'file' })` 加载的额外 HTML 目录或文件、每个文件窗口自己的 preload、`.node` 原生模块、`.exe`/可执行文件、`aperture` 等外部二进制。

## 权限声明 (permissions)

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `runCommand` | `boolean` | 旧版命令执行权限。仅授权插件自身直接调用 `shell.runCommand`，不授权插件承载 AI 生成命令。新插件优先使用 `commandExecution.direct`。 |
| `commandExecution` | `object` | 命令执行分场景授权。可分别声明 `direct`（插件代码直接调用）和 `ai`（插件承载 AI 生成命令）。 |
| `webview` | `boolean` | 允许插件 UI 使用 Electron `<webview>` 作为普通远程网页容器。宿主只会对声明为 `true` 的插件开启 `webviewTag`，并会移除 guest preload、关闭 Node 集成。 |
| `screen` | `boolean` | 允许插件访问屏幕录制/截图能力。插件调用 `screen.getSources()`、`screen.getWindowBounds()`、`screen.capture()`、`screen.captureRegion()`、`screen.getMediaStreamConstraints()`，或通过 `chromeMediaSource: 'desktop'` 进行桌面捕获时必须声明。 |
| `microphone` | `boolean` | 允许插件访问麦克风。插件 UI 调用 `getUserMedia({ audio: true })` 或使用 `media` / `permission` 的麦克风权限 API 时必须声明。 |
| `camera` | `boolean` | 允许插件访问摄像头。插件 UI 调用普通摄像头 `getUserMedia({ video: true })` 或使用 `media` / `permission` 的摄像头权限 API 时必须声明；桌面录制视频流使用 `screen`。 |
| `clipboard` | `boolean` | 允许插件读写系统剪贴板，以及查询/复制剪贴板历史。 |
| `notification` | `boolean` | 允许插件发送系统通知。 |
| `geolocation` | `boolean` | 允许插件访问定位权限 API 和获取当前位置。 |
| `accessibility` | `boolean` | 允许插件检查/请求系统辅助功能权限。 |
| `contacts` | `boolean` | 允许插件检查/请求通讯录权限。 |
| `calendar` | `boolean` | 允许插件检查/请求日历权限。 |
| `inputMonitor` | `boolean` | 允许插件调用全局输入监听 API（鼠标点击轨迹、键盘按键监听）。macOS 通常还需声明 `accessibility` 并获得系统辅助功能授权。详见 [全局输入监听 API](./input-monitor.md)。 |
| `envKeys` | `string[] \| "*"` | 命令执行继承环境变量的特别声明。仅在 legacy `runCommand` 或 `commandExecution` 启用时生效。在非沙箱主应用或非沙箱 `*` 声明时，完整继承；其余情况下，插件默认继承 `process.env`（但自动排除全局设置 `settings.commandRunner.denyEnvKeys` 黑名单键以及 `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `LD_LIBRARY_PATH` 等危险注入变量）。若需强制继承这些被排除的键，需在此显式声明。 |

### 命令执行权限 (commandExecution)

`commandExecution` 将“插件代码直接调命令”和“插件承载 AI 生成命令”拆开授权，避免 AI 插件继承 legacy `runCommand` 权限。

```json
{
  "permissions": {
    "commandExecution": {
      "direct": {
        "enabled": true,
        "defaultProfile": "workspace",
        "maxProfile": "workspace"
      },
      "ai": {
        "enabled": true,
        "defaultProfile": "sandbox",
        "maxProfile": "workspace"
      }
    },
    "envKeys": ["PATH", "JAVA_HOME"]
  }
}
```

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `commandExecution.direct.enabled` | `boolean` | 允许插件自身调用 `context.api.shell.runCommand`。 |
| `commandExecution.direct.defaultProfile` | `"sandbox" \| "workspace" \| "trusted"` | 插件直接命令未显式传 `executionProfile` 时使用的默认 profile。 |
| `commandExecution.direct.maxProfile` | `"sandbox" \| "workspace" \| "trusted"` | 插件直接命令允许请求的最高 profile。 |
| `commandExecution.ai.enabled` | `boolean` | 允许该插件承载的 AI 使用 Mulby 内置命令型能力，如 `shell.exec` / `git.diff` / `patch.apply`。 |
| `commandExecution.ai.defaultProfile` | `"sandbox" \| "workspace" \| "trusted"` | 插件承载 AI 命令的默认 profile。 |
| `commandExecution.ai.maxProfile` | `"sandbox" \| "workspace" \| "trusted"` | 插件承载 AI 命令允许请求的最高 profile。 |

默认策略：

- 未声明 `commandExecution.direct` 但声明了 `runCommand: true`：兼容旧插件，直接命令默认/最高为 `trusted`。
- 显式声明 `commandExecution.direct.enabled: true`：默认/最高为 `workspace`，除非 manifest 指定 profile。
- 显式声明 `commandExecution.ai.enabled: true`：默认/最高为 `sandbox`，除非 manifest 指定 profile。
- 未声明 `commandExecution.ai.enabled`：插件承载 AI 的命令型能力会被过滤或拒绝，即使插件有 `runCommand: true`。

目录访问不在 manifest 中预声明。插件需要访问用户项目目录时，应在运行时调用 [`directoryAccess.request()`](./directory-access.md) 申请 `read` 或 `readwrite` 授权；授权只扩展文件/命令 root 范围，不替代 `commandExecution.direct` 或 `commandExecution.ai`。

插件前端可通过 `window.mulby.onPluginInit()` 读取宿主暴露的能力状态：

```ts
window.mulby.onPluginInit((data) => {
  if (data.capabilities?.webview) {
    // 可以创建 <webview>
  }
})
```

## 插件功能特性配置 (PluginFeature)

在 `features` 数组中，针对每一项支持以下属性：

| 字段名 | 类型 | 是否必填 | 描述 |
| --- | --- | --- | --- |
| `code` | `string` | **是** | 功能唯一代码。 |
| `explain` | `string` | **是** | 该功能的含义说明。 |
| `cmds` | `PluginCmd[]` | **是** | 触发该功能的所有匹配指令。详细配置见下文“指令触发机制 (Cmds)”。 |
| `mode` | `'ui' \| 'silent' \| 'detached'` | 否 | 运行模式：`ui` 渲染到搜索框、`silent` 后台静默执行、`detached` 以独立窗口运行。 |
| `route` | `string` | 否 | 如果运行模式包含 UI，此字段可设置加载的路由（React前端对应路由）。 |
| `icon` | `PluginIcon` | 否 | 特性独享的图标，覆盖全局 `icon`。 |
| `mainPush` | `boolean` | 否 | 启用搜索框推送：匹配时查询后端的 `onMainPush` 回调获取动态选项。详见 [动态指令 API](./features.md) 的 MainPush 章节。 |
| `mainHide` | `boolean` | 否 | 触发该功能模块后，是否隐藏 Mulby 超级面板主窗口。 |
| `preCapture` | `'region' \| 'fullscreen'` | 否 | 触发插件功能前先进行屏幕截图（部分区域或全屏），并将截图作为附件(attachment)传给插件。 |

---

## 指令触发机制 (PluginCmd)

在上述 `cmds` 中配置不同的触发条件。插件可以在多种情况下被调起：

### 1. 关键字匹配 (keyword)
指定唯一的关键词，当用户在 Mulby 输入框输入此词即可匹配。
- `type`: 固定为 `"keyword"`
- `value`: 具体的触发词，如 `"json"`。

### 2. 正则表达式匹配 (regex)
对用户的输入内容进行正则校验。
- `type`: 固定为 `"regex"`
- `match`: 必须填，正则表达式的字符串。
- `label`: （可选）指令展示的名称。
- `explain`: （可选）正则的解释说明。
- `minLength`: （可选）输入内容所需要的最少字符数。
- `maxLength`: （可选）输入内容的最多字符数。

### 3. 本地文件匹配 (files)
拖拽或者传递文件信息。
- `type`: 固定为 `"files"`
- `label`: （可选）显示名称。
- `exts`: （可选）匹配文件拓展名数组，如 `[".json", ".png"]`。
- `fileType`: （可选）过滤类型：`"file"` (普通文件), `"directory"` (目录), `"any"` (任何)。默认为 `"any"`。
- `match`: （可选）匹配文件名的正则表达式。
- `minLength`: （可选）至少多少个文件。
- `maxLength`: （可选）最多多少个文件。

### 4. 纯图片匹配 (img)
主要用于拖拽或选中的专门图片格式。
- `type`: 固定为 `"img"`
- `label`: （可选）指令名称。
- `exts`: （可选）限定的图片拓展后缀名等。

### 5. 全局选中文字匹配 (over)
- `type`: 固定为 `"over"`
- `label`: （可选）显示名称。
- `exclude`: （可选）排版的正则匹配字符串，如果匹配则不响应此指令。
- `minLength` / `maxLength`: （可选）文字最小与最大字数限定。

### 6. 前台应用窗口匹配 (window)
通过调用方当时处于前台活跃的不同软件，提供特定的快捷辅助能力。
- `type`: 固定为 `"window"`
- `app`: （可选）应用名正则或字符串。如 `/Chrome|Safari/` 或直接写全名。
- `title`: （可选）匹配窗口的具体标题提取内容。
- `bundleId`: （可选，限 macOS 平台）匹配系统的 Bundle ID，例如 `com.apple.Safari`。
- `label`: （可选）前端 UI 展示。

---

## AI 工具声明 (PluginToolSchema)

使插件可以将某些内部能力以工具 (`tools`) 形式暴露给 AI Agent 进行调用。

| 字段名 | 类型 | 是否必填 | 描述 |
| --- | --- | --- | --- |
| `name` | `string` | **是** | Tool 名称，插件范围内唯一（只允许 `[a-zA-Z0-9_-]`）。 |
| `description` | `string` | **是** | 该 Tool 的功能描述（非常重要，AI 需要以此理解其目的）。 |
| `inputSchema` | `object` | **是** | JSON Schema。`type` 必须为 `"object"`。定义 `properties`, `required` 等参数结构。 |
| `outputSchema`| `object` | 否 | 返回值数据结构的 JSON Schema。 |

### AI Tool 进度上报

执行时间较长的 Tool（建议 5 秒以上）可以在 handler 第二参数 `ctx` 中调用 `sendProgress`，向 Mulby AI Agent 和 Mulby MCP Server 上报任务进度：

```ts
mulby.tools.register('long_task', async (args, ctx) => {
  ctx?.sendProgress({ progress: 1, total: 3, message: '读取输入' })
  // ...
  ctx?.sendProgress({ progress: 2, total: 3, message: '处理中' })
  // ...
  ctx?.sendProgress({ progress: 3, total: 3, message: '完成' })
  return { ok: true }
})
```

`sendProgress` 参数为 `{ progress: number; total?: number; message?: string }`。`progress` 是必填的有限数字，`total` 可表示总步骤或总工作量，`message` 是当前阶段说明。

---

## 插件应用后台与运行设定 (PluginSetting)

底层和生命周期相关的控制设定。

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `single` | `boolean` | 是否只允许单例运行。默认 `true`。 |
| `defaultDetached` | `boolean` | 是否默认让此插件以独立窗口运行。默认 `false`。用户也可以在插件菜单中勾选“始终以独立窗口运行”，该用户偏好优先于 manifest 默认值。 |
| `background` | `boolean` | 是否允许本插件在后台保留运行（适用于消息监听、常驻定时调度等）。它只表示能力，不会让插件随 Mulby 启动自动运行；跟随启动由用户在插件窗口菜单或搜索结果右键菜单中勾选。勾选后 Mulby 会按插件能力启动：有后台则启动后台，有 UI 则隐藏缓存用户勾选时对应的 UI。 |
| `persistent` | `boolean` | 是否在 Mulby 重启后恢复“上次退出前正在后台运行”的状态。仅在 `background: true` 时有效。 |
| `height` | `number` | Mulby Super Panel 面板启动此 UI 插件时使用的预期高度。 |
| `maxRuntime` | `number` | 限定最大运行时间（毫秒）。超时会自动终止进程。`0` 表示无限制。 |
| `idleTimeoutMs` | `number` \| `'never'` | 宿主进程空闲多少毫秒后自动销毁内存。设置为 `'never'` 可以永不过期。默认 5 分钟。 |
| `resourceLimits` | `object` \| `string` | 对该插件可设置资源限制。可以是字符串级别的 `"low"`, `"medium"`, `"high"`, `"unlimited"`；或者提供更复杂的对象限额，如 `{ "maxMemoryMB": 200 }`。 |

`background`、`persistent`、`defaultDetached` 都是插件声明的能力或默认行为；是否跟随 Mulby 启动、是否始终以独立窗口运行，最终由用户在 Mulby 的插件菜单或搜索结果右键菜单中决定并保存在本机用户状态里。

---

## 独立窗口设定 (WindowOptions)

如果 `features` 的 `mode` 设置为 `"detached"`，或插件自主新开窗口，可以设置这些 UI 级参数。

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `width` / `height` | `number` | 宽高默认大小像素。 |
| `minWidth` / `minHeight` | `number` | 窗口拖拽缩放边界尺寸。 |
| `maxWidth` / `maxHeight` | `number` | 窗口可被放大的最大尺寸范围。 |
| `type` | `string` | 窗口结构类型。可选：`default` (常规标题栏), `borderless` (无边框的定制), `fullscreen` (全屏沉浸应用)。 |
| `titleBar` | `boolean` | 显式强制决定是否展示带有 Mulby 原生风格标题栏。 |
| `alwaysOnTop` | `boolean` | detached 窗口初始是否置顶。适合截图标注工具条、浮动控制面板等短时窗口。 |
| `resizable` | `boolean` | 是否允许用户调整窗口大小。默认 `true`。 |
| `fullscreenable` | `boolean` | 是否允许进入系统全屏/缩放。默认 `true`；macOS 上也会影响最大化能力。 |
| `opacity` | `number` | 初始时窗口的整体透明度占比。支持范围 `0.0` - `1.0`。 |
| `transparent` | `boolean` | 创建时就开启窗口层穿透方案，用以实现类似异形悬浮窗的设计（需要搭配 CSS 背景 `transparent` 运作）。 |
| `visibleOnAllWorkspaces` | `boolean` | 是否在所有桌面/工作区可见。 |
| `visibleOnFullScreen` | `boolean` | 配合 `visibleOnAllWorkspaces`，是否在全屏应用上方可见（macOS）。 |
| `ignoreMouseEvents` | `boolean` | detached 窗口初始是否忽略鼠标事件，用于透明区域点击穿透。 |
| `forwardMouseEvents` | `boolean` | 配合 `ignoreMouseEvents`，穿透时是否继续转发鼠标移动事件以支持 hover/mousemove 检测。 |
| `skipTaskbar` | `boolean` | 请求从任务栏/Dock 隐藏该窗口。macOS 的 Dock 是应用级表示，存在其他独立窗口时 Mulby 仍可能显示 Dock 图标。 |
| `backgroundThrottling` | `boolean` | 是否允许 Chromium 在窗口后台/遮挡时节流 timer 和 repaint。默认 `true`；设置为 `false` 可让录屏控制面板、计时器、悬浮监控等窗口持续刷新。 |
| `position` | `'default' \| 'capture-region'` | 当功能使用 `preCapture: 'region'` 时，可将 detached 窗口左上角定位到截图区域左上角。无法获取截图区域坐标的平台会回退到默认定位。 |
| `fit` | `'default' \| 'capture-region' \| 'capture-region-with-toolbar'` | 当功能使用 `preCapture: 'region'` 时，可将 detached 窗口尺寸适配到截图区域；`capture-region-with-toolbar` 会额外增加工具条高度。 |
| `captureToolbarHeight` | `number` | `fit: 'capture-region-with-toolbar'` 时追加的工具条高度，默认 `56`。 |

### macOS Dock 表示

独立窗口在 macOS 上使用 Mulby 的应用级 Dock 图标表示，而不是每个插件创建一个独立 app 图标。存在插件独立窗口时，Dock 图标会显示为“宿主图标 + 最近聚焦插件图标”的组合样式；存在多个插件的独立窗口时，会按插件数量显示徽标。同一插件创建多个窗口时只占一个 Dock 表示。独立系统页面会使用宿主图标。

Dock 右键菜单会按插件聚合显示窗口项，并提供关闭插件窗口、打开 Mulby 和退出 Mulby 等操作。系统 Dock 的“退出”语义仍然是退出宿主应用；只关闭插件应使用插件窗口菜单或插件 UI 的关闭动作。

`skipTaskbar` 不能作为隐藏 Mulby Dock 图标的开关。macOS 的 Dock 图标跟随应用级独立窗口状态，只要仍有需要表示的独立窗口，Mulby 可能保持 Dock 可见。

截图标注类插件的典型配置：

```json
{
  "features": [
    {
      "code": "annotate",
      "explain": "截图标注",
      "mode": "detached",
      "preCapture": "region",
      "cmds": [{ "type": "keyword", "value": "截图标注" }]
    }
  ],
  "window": {
    "type": "borderless",
    "titleBar": false,
    "transparent": true,
    "alwaysOnTop": true,
    "backgroundThrottling": false,
    "position": "capture-region",
    "fit": "capture-region-with-toolbar",
    "captureToolbarHeight": 56
  }
}
```

---

## 图标配置 (PluginIcon)

支持以下几种类型的传值（可以在全局 `icon` 或具体的特性 `features[].icon` 里面混合使用）：

- **相对路径**：例如 `"icon.png"`，将指向根目录。
- **URL**：直接传递 `"https://..."` 网络可用图标。
- **SVG 代码段**：`<svg>...</svg>`
- **Emoji**：例如 `"🚀"`。
- **高级声明对象**：通过 `"type"` 显式指明：
  - `{ "type": "file", "value": "images/icon.png" }`
  - `{ "type": "url", "value": "https://xxxxx" }`
  - `{ "type": "svg", "value": "<svg>...</svg>" }`
  - `{ "type": "emoji", "value": "🔥" }`
