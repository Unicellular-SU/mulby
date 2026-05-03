# 修复 `mulby.window.create()` + 覆盖层窗口支持

## 背景

录屏插件需要通过 `window.create()` 创建一个全屏透明覆盖层窗口，显示录制计时器、停止按钮、鼠标点击波纹动画和键盘按键提示。

当前存在三个根本性 Bug：

1. **Hash 解析错误**：`createAuxiliaryWindow` 将整个 path 字符串（如 `/index.html#overlay?a=1`）直接截去开头 `/` 后作为 hash 传给 `loadFile`，导致 `#overlay?a=1` 被当成一个完整 hash 值，前端路由无法识别。
2. **Query 参数完全丢失**：`loadFile(path, { hash })` 不支持将 query 传进去，覆盖层所需的配置参数（`showClicks`、`showKeyboard` 等）无法传递。
3. **`onPluginInit` 类型缺失 `route`/`params` 字段**：preload 层的 `PluginInitData` 类型没有暴露 `route` 和 `params`，插件前端无法感知。

## 方案概述（A + B）

- **A（插件侧）**：修正 `window.create()` 调用方式，使用干净的 hash 路由名 + 结构化 `params` 选项。
- **B（宿主侧）**：修复 `createAuxiliaryWindow` 的路径解析逻辑；在 `AuxiliaryWindowOptions` 增加 `params` 字段；更新 preload 类型暴露 `route`/`params`。

---

## Proposed Changes

### 宿主层（Host）

---

#### [MODIFY] [window.ts](file:///Users/su/workspace/mulby/src/main/plugin/window.ts)

**1. 新增 `parseAuxiliaryPath()` 辅助函数**

正确解析插件传入的路径字符串，支持以下格式：

| 输入示例 | hash | search |
|---------|------|--------|
| `overlay` | `overlay` | — |
| `/overlay` | `overlay` | — |
| `#overlay` | `overlay` | — |
| `/index.html#overlay` | `overlay` | — |
| `overlay?a=1&b=2` | `overlay` | `?a=1&b=2` |
| `/index.html#overlay?a=1` | `overlay` | `?a=1` |

```ts
/** 解析辅助窗口路径，分离 hash 路由名和 query 参数串 */
function parseAuxiliaryPath(path: string): { hash: string; search?: string } {
  let cleaned = path
  // 去掉 /xxx.html 文件名前缀（如 /index.html）
  cleaned = cleaned.replace(/^\/[^#?]*\.html/, '')
  // 去掉开头的 / 或 #
  cleaned = cleaned.replace(/^[/#]+/, '')
  const qIndex = cleaned.indexOf('?')
  if (qIndex === -1) return { hash: cleaned }
  return {
    hash: cleaned.substring(0, qIndex),
    search: cleaned.substring(qIndex) // 保留 ? 前缀
  }
}
```

**2. `AuxiliaryWindowOptions` 增加 `params` 字段**

```ts
interface AuxiliaryWindowOptions {
  // ...已有字段...
  params?: Record<string, string>  // ← 新增：结构化参数，透传至 plugin:init
}
```

**3. `createAuxiliaryWindow` 使用新解析函数**

替换第 961 行的错误 hash 提取，改用 `parseAuxiliaryPath()`，并把 `search` 也传给 `loadFile`：

```ts
// Before（错误）
const hash = path.startsWith('/') ? path.substring(1) : path
// ...
win.loadFile(uiPath, { hash })

// After（正确）
const { hash, search } = parseAuxiliaryPath(path)
// ...
win.loadFile(uiPath, { hash, ...(search ? { search } : {}) })
// pluginView 分支同理
pluginView.webContents.loadFile(uiPath, { hash, ...(search ? { search } : {}) })
```

**4. `plugin:init` 事件携带 `params`**

在 `did-finish-load` 回调中（第 1040 行 `pluginWebContents.send('plugin:init', ...)`），追加 `params` 字段：

```ts
pluginWebContents.send('plugin:init', {
  pluginName: plugin.id,
  featureCode: '',
  input: '',
  attachments: [],
  mode: 'detached',
  windowType,
  route: path,       // 已有，发送原始 path
  params: options?.params,  // ← 新增
  capabilities: getPluginRendererCapabilities(plugin),
  nonce: Date.now()
})
```

---

### Preload 层

---

#### [MODIFY] [app-plugin-api.ts](file:///Users/su/workspace/mulby/src/preload/apis/app-plugin-api.ts)

**更新 `PluginInitData` 类型，暴露 `route` 和 `params`**

```ts
type PluginInitData = {
  pluginName: string
  featureCode: string
  input: string
  attachments?: InputPayload['attachments']
  mode?: string
  capabilities?: PluginRendererCapabilities
  nonce?: number
  route?: string                    // ← 新增
  params?: Record<string, string>   // ← 新增
  windowType?: string               // ← 新增（已在主进程发送，补全类型）
}
```

同时更新 `onPluginInit` 回调参数类型，使插件开发者能访问这两个字段：

```ts
return (callback: (data: {
  pluginName: string
  featureCode: string
  input: string
  attachments?: InputPayload['attachments']
  mode?: string
  capabilities?: PluginRendererCapabilities
  route?: string                  // ← 新增
  params?: Record<string, string> // ← 新增
  windowType?: string             // ← 新增
}) => void) => { ... }
```

#### [MODIFY] [core-api.ts](file:///Users/su/workspace/mulby/src/preload/apis/core-api.ts)

**`window.create()` 的 options 类型增加 `params`**

```ts
create: async (url: string, options?: {
  // ...已有字段...
  params?: Record<string, string>  // ← 新增：透传给覆盖层窗口的配置
}) => { ... }
```

---

### 插件开发侧（A — 录屏插件正确用法）

不修改宿主代码，此部分为文档/参考示例：

```ts
// ✅ 正确调用方式
const overlayHandle = await window.mulby.window.create(
  'overlay',  // 只传路由名（hash），不含 /index.html 前缀
  {
    type: 'borderless',
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    params: {               // 结构化参数，通过 plugin:init 透传
      showClicks: 'true',
      showKeyboard: 'true',
      recordingMode: 'fullscreen',
    },
  }
)

// 覆盖层窗口前端：监听 plugin:init
window.mulby.onPluginInit(({ route, params }) => {
  if (route === 'overlay') {
    initOverlay({
      showClicks: params?.showClicks === 'true',
      showKeyboard: params?.showKeyboard === 'true',
      recordingMode: params?.recordingMode ?? 'fullscreen',
    })
  }
})
```

---

## Verification Plan

### 自动化检查
```bash
pnpm typecheck   # 确保类型无报错
pnpm build       # 验证构建通过
```

### 手动验证
1. 在录屏插件中调用 `window.create('overlay', { transparent: true, ... })`，确认子窗口以正确的 hash 路由加载。
2. 在覆盖层窗口的 `onPluginInit` 回调中 `console.log` 出 `route` 和 `params`，确认值符合预期。
3. 验证 `window.create('/index.html#overlay?showClicks=true')` 这种旧写法也能被正确解析（向后兼容）。
4. 验证 `screen-pin` 插件的 `window.create('/index.html?mode=pin&img=...')` 仍能正常工作（query 参数被解析到 `search`）。
