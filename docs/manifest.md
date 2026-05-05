# Mulby 插件 Manifest 规范

## 核心概念

### Features（功能入口）
一个插件可以有多个功能入口，每个功能入口可以有不同的触发方式。

## manifest.json 结构

```json
{
  "name": "json-tools",
  "version": "1.0.0",
  "displayName": "JSON 工具箱",
  "description": "JSON 格式化、压缩、校验等功能",
  "main": "main.js",
  "features": [
    {
      "code": "format",
      "explain": "格式化 JSON",
      "cmds": [
        { "type": "keyword", "value": "json" },
        { "type": "keyword", "value": "格式化" },
        { "type": "regex", "match": "^\\s*[{\\[]", "explain": "检测到 JSON" }
      ]
    },
    {
      "code": "minify",
      "explain": "压缩 JSON",
      "cmds": [
        { "type": "keyword", "value": "json压缩" }
      ]
    }
  ]
}
```

## 字段说明

### 顶层字段
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 插件唯一标识 |
| version | string | 是 | 版本号 |
| type | PluginType | 否 | 插件类型（utility/productivity/developer/system/media/network/ai/entertainment/other） |
| author | string | 否 | 作者名称 |
| homepage | string | 否 | 插件主页/网站 |
| displayName | string | 是 | 显示名称 |
| main | string | 是 | 入口文件 |
| ui | string | 否 | UI 文件路径 |
| preload | string | 否 | 自定义 preload 脚本路径（可使用 Node.js） |
| icon | string/object | 否 | 插件图标 |
| permissions | object | 否 | 插件权限声明，如 `runCommand`、`screen`、`microphone`、`camera`、`clipboard`、`notification`、`inputMonitor` |
| features | array | 是 | 功能入口列表 |
| window | object | 否 | 独立窗口配置 |
| pluginSetting | object | 否 | 插件行为设置 |

### Permissions 配置

```json
{
  "permissions": {
    "screen": true,
    "microphone": true,
    "camera": true,
    "clipboard": true,
    "notification": true
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| runCommand | boolean | 允许插件调用受策略保护的命令执行能力 |
| screen | boolean | 允许插件访问屏幕录制/截图能力，包括 `screen.getSources()`、`screen.capture()`、`screen.captureRegion()`、`screen.getMediaStreamConstraints()` 和桌面捕获 `getUserMedia` |
| microphone | boolean | 允许插件访问麦克风，包括 `getUserMedia({ audio: true })` 和麦克风权限 API |
| camera | boolean | 允许插件访问摄像头，包括普通摄像头 `getUserMedia({ video: true })` 和摄像头权限 API；桌面录制视频流使用 `screen` 而不是 `camera` |
| clipboard | boolean | 允许插件读写系统剪贴板和访问剪贴板历史 |
| notification | boolean | 允许插件发送系统通知 |
| geolocation | boolean | 允许插件访问定位权限 API 和获取当前位置 |
| accessibility | boolean | 允许插件检查/请求系统辅助功能权限 |
| contacts | boolean | 允许插件检查/请求通讯录权限 |
| calendar | boolean | 允许插件检查/请求日历权限 |
| webview | boolean | 允许插件 UI 使用 Electron `<webview>` |
| inputMonitor | boolean | 允许插件监听全局鼠标/键盘输入事件；在 macOS 上通常还需要同时声明 `accessibility` |
| envKeys | string[] \| "*" | `runCommand` 继承环境变量的额外白名单 |

### PluginSetting 配置

控制插件运行行为。

```json
{
  "pluginSetting": {
    "single": true,
    "height": 400,
    "background": true,
    "persistent": true,
    "maxRuntime": 3600000
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| single | boolean | true | 是否单例模式运行（不允许多开） |
| height | number | - | 插件初始高度 |
| defaultDetached | boolean | false | 是否默认以独立窗口运行 |
| background | boolean | false | 是否允许后台运行 |
| persistent | boolean | false | 是否持久化（重启后自动恢复，需开启 background） |
| maxRuntime | number | 0 | 最大运行时间（毫秒，0 表示无限制），仅对 background 插件有效 |
| idleTimeoutMs | number \| 'never' | 300000 | 宿主进程空闲多久后自动销毁（毫秒）。`'never'` 或 `0` 表示永不销毁。**注意：`background: true` 的插件自动等同于 `'never'`，无需重复配置。** |

### Window 配置

配置插件在独立窗口模式下的窗口行为和尺寸。

#### 窗口类型

通过 `type` 字段控制窗口的外观模式：

- **`default`**（默认）：带有 Mulby 标题栏的标准独立窗口，包含置顶、最小化、最大化、关闭等按钮。
- **`borderless`**：无边框窗口，没有标题栏和系统边框。插件 UI 完全控制窗口外观，需要自行处理拖拽区域（通过 CSS `-webkit-app-region: drag`）。
- **`fullscreen`**：全屏窗口，自动占满主屏幕工作区，没有标题栏。适合截图标注、画板等沉浸式工具。

```json
{
  "window": {
    "type": "default",
    "width": 800,
    "height": 600,
    "minWidth": 400,
    "minHeight": 300,
    "maxWidth": 1200,
    "maxHeight": 900
  }
}
```

#### 无边框窗口示例

```json
{
  "window": {
    "type": "borderless",
    "width": 300,
    "height": 200
  }
}
```

> 无边框窗口需要插件 UI 自行实现拖拽和关闭逻辑。拖拽区域可通过 CSS 指定：
> ```css
> .drag-region { -webkit-app-region: drag; }
> .no-drag { -webkit-app-region: no-drag; }
> ```

#### 全屏窗口示例

```json
{
  "window": {
    "type": "fullscreen"
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | string | `"default"` | 窗口类型：`default`（带标题栏）、`borderless`（无边框）、`fullscreen`（全屏） |
| titleBar | boolean | - | 是否显示 Mulby 标题栏（`default` 默认 `true`，其他类型默认 `false`） |
| width | number | 500 | 默认宽度 |
| height | number | 400 | 默认高度 |
| minWidth | number | 300 | 最小宽度 |
| minHeight | number | 200 | 最小高度 |
| maxWidth | number | - | 最大宽度（不设置则无限制） |
| maxHeight | number | - | 最大高度（不设置则无限制） |
| backgroundThrottling | boolean | true | 是否允许后台/遮挡窗口节流 timer 和 repaint。录屏、计时器、悬浮监控等需要持续刷新的 detached 窗口可设为 `false` |

### Feature 字段
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| code | string | 是 | 功能代码，传递给插件 |
| explain | string | 是 | 功能说明，显示给用户 |
| cmds | array | 是 | 触发命令列表 |
| mode | string | 否 | 执行模式（ui/silent/detached） |
| route | string | 否 | UI 路由 |
| icon | string/object | 否 | 功能独立图标（支持路径/svg/网络链接） |
| mainPush | boolean | 否 | 是否向搜索框推送内容 |
| mainHide | boolean | 否 | 触发该功能时不显示主窗口 |

### Cmd 类型
| type | 说明 | 额外字段 |
|------|------|----------|
| keyword | 关键词触发 | value: 关键词 |
| regex | 正则匹配 | match: 正则, explain: 说明, label?: 指令名称, minLength?: 最少字符数, maxLength?: 最多字符数 |
| files | 文件/文件夹 | label?: 指令名称, exts?: 扩展名数组, fileType?: file/directory/any (默认 any), match?: 文件名正则 (与 exts 二选一), minLength?: 最少数量, maxLength?: 最多数量 |
| img | 图片 | label?: 指令名称, exts?: [".png", ".jpg"] |
| over | 选中文本 | label?: 指令名称, exclude?: 排除正则, minLength?: 最少字符数, maxLength?: 最多字符数 (默认 10000) |
| window| 窗口聚焦 | label?: 指令名称, app?: 匹配应用名称, title?: 匹配窗口标题, bundleId?: 匹配 macOS bundle ID |

#### 功能指令 vs 匹配指令

- 功能指令：`keyword`
- 匹配指令：`regex` / `files` / `img` / `over` / `window`

当前指令快捷键仅支持绑定功能指令（`keyword`）。匹配指令在搜索输入满足条件时展示。

#### 文件/图片匹配说明

- `files`：当输入包含附件时，若任一附件扩展名命中 `exts` 列表则匹配。
- `img`：当输入包含图片附件时匹配；若提供 `exts`，则只匹配扩展名命中的图片。
- 扩展名可写成 `.png` 或 `png`，系统会自动规范化；支持 `*`/`.*` 作为通配。
- 当 `exts` 为空或未提供时，插件会接收全部附件；否则仅传递扩展名命中的附件。

示例：

```json
{
  "code": "pdf-only",
  "explain": "处理 PDF",
  "cmds": [
    { "type": "files", "exts": [".pdf"] }
  ]
}
```

若用户输入包含 `a.pdf`、`b.pdf`、`c.png`，则该 feature 会匹配，并且仅向插件传递两个 `.pdf` 附件。

// SVG
"icon": { "type": "svg", "value": "<svg>...</svg>" }

// Emoji
"icon": { "type": "emoji", "value": "🚀" }
```

#### 默认行为

- 未设置 `icon` 时，自动尝试加载插件目录下的 `icon.png`
- 若无图标文件，显示默认占位图标

### Icon 字段

插件图标支持四种格式，可使用字符串简写或对象形式。

#### 字符串简写

```json
// 本地文件
"icon": "icon.png"

// URL
"icon": "https://example.com/icon.png"

// Emoji (直接使用 Emoji 字符)
"icon": "🚀"

// 内联 SVG
"icon": "<svg viewBox=\"0 0 24 24\">...</svg>"
```

#### 对象形式

```json
// 本地文件
"icon": { "type": "file", "value": "assets/logo.png" }

// URL
"icon": { "type": "url", "value": "https://example.com/icon.png" }

### Preload 配置

配置自定义 preload 脚本，可在渲染进程中使用 Node.js 能力。

```json
{
  "preload": "preload.js"
}
```

#### preload.js 示例

```javascript
// preload.js - 遵循 CommonJS 规范
const fs = require('fs')
const os = require('os')
const path = require('path')

// 通过 window 暴露给前端
window.myApi = {
  getHomeDir: () => os.homedir(),
  readFile: (filePath) => fs.readFileSync(filePath, 'utf-8'),
  platform: process.platform
}
```

#### 前端使用

```typescript
// 在 UI 组件中使用
const homeDir = window.myApi?.getHomeDir()
const content = window.myApi?.readFile('/path/to/file.txt')
```

#### 注意事项

- preload.js 必须是清晰可读的源码，不能压缩/混淆
- 可以使用 Node.js 原生模块和第三方模块
- 通过 `window.xxx` 暴露 API 给前端
- `window.mulby` 核心 API 仍然可用
