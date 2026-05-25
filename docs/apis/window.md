# 窗口 API (window)
本文档描述窗口 API (window) 的使用方式与接口。

> 入口：`window.mulby.window`

### hide(isRestorePreWindow?)
[Renderer]
隐藏当前窗口。

### show()
[Renderer]
显示当前窗口。

### showInactive()
[Renderer]
显示当前窗口但不主动抢占焦点，适用于悬浮层、桌面宠物等需要保持可见但不打断当前应用焦点的 detached 窗口。

### focus()
[Renderer]
聚焦当前窗口。独立窗口和子窗口可用它在用户明确交互后请求焦点；macOS 上宿主会尽量避免把普通 Dock 同步误判为焦点切换。

### setTitle(title)
[Renderer]
设置当前窗口标题。

### setSize(width, height)
[Renderer]
设置窗口大小。

### setPosition(x, y)
[Renderer]
设置当前窗口左上角屏幕坐标。

### setBounds(bounds)
[Renderer]
设置当前窗口边界。`bounds` 可只传部分字段：`{ x?, y?, width?, height? }`。

### getBounds()
[Renderer]
获取当前窗口边界，返回 `{ x, y, width, height }`，无法解析窗口时返回 `null`。

### setExpendHeight(height, allowResize?)
[Renderer]
仅调整窗口高度。

### center()
[Renderer]
窗口居中。

### setAlwaysOnTop(flag, level?)
[Renderer]
设置窗口置顶状态。`level` 可选，语义与 Electron `BrowserWindow.setAlwaysOnTop` 一致，例如 `'floating'`、`'screen-saver'`。

### setIgnoreMouseEvents(ignore, options?)
[Renderer]
设置当前窗口是否忽略鼠标事件。`options.forward: true` 时，窗口穿透点击的同时仍会转发鼠标移动事件给渲染进程，可用于 CSS hover/mousemove 检测。

```javascript
window.mulby.window.setIgnoreMouseEvents(true, { forward: true });
window.mulby.window.setIgnoreMouseEvents(false);
```

### setVisibleOnAllWorkspaces(flag, options?)
[Renderer]
设置当前窗口是否在所有桌面/工作区可见。`options.visibleOnFullScreen: true` 可请求在 macOS 全屏应用上方可见。

### setFullScreen(flag)
[Renderer]
设置当前窗口全屏状态。

### setBackgroundThrottling(allowed)
[Renderer]
设置当前插件内容 `webContents` 是否允许后台节流。语义与 Electron 一致：`true` 表示允许后台节流，`false` 表示禁用节流，让窗口即使被判定为后台/遮挡也继续刷新 timer/repaint。

### detach()
[Renderer]
将插件窗口分离为独立窗口。

macOS 上，分离后的插件窗口会让 Mulby 显示应用级 Dock 图标。Dock 图标会优先使用“宿主图标 + 最近聚焦插件图标”的组合样式，多个插件同时有窗口时按插件数量显示徽标。同一插件创建多个窗口时只占一个 Dock 表示。Dock 右键菜单可用于切换或关闭插件窗口；系统 Dock 的“退出”仍然退出宿主应用。

### close()
[Renderer]
关闭当前插件窗口。

### terminatePlugin()
[Renderer]
终止当前插件进程（与「关闭窗口」不同，用于强制结束插件）。返回是否成功及可选错误信息。

### showPluginMenu(point?)
[Renderer]
在屏幕坐标 `point`（通常为 `{ x, y }`）处显示当前附加插件的菜单（例如标题栏按钮场景）。未传 `point` 时使用默认位置。返回是否已展示菜单。

### reload()
[Renderer]
重新加载当前插件窗口。

### getMode()
[Renderer]
获取当前插件窗口模式：`'attached' | 'detached'`。

### getWindowType()
[Renderer]
获取窗口类型：`'main' | 'detach'`。

### getState()
[Renderer]
获取窗口状态：`{ isMaximized: boolean; isAlwaysOnTop: boolean }`。

### minimize()
[Renderer]
最小化窗口。

### maximize()
[Renderer]
最大化/还原窗口。

### resizeDrag(payload)
[Renderer]
在自定义标题栏/边框场景下，驱动主进程执行窗口边缘拖拽缩放。

### create(url, options?)
[Renderer]
创建子窗口并返回控制句柄。

```typescript
interface ChildWindowCreateOptions {
  width?: number;
  height?: number;
  title?: string;
  loadMode?: 'route' | 'file';         // 默认 'route'
  preload?: string;                    // 仅 loadMode: 'file' 时指定该子窗口 preload
  type?: 'default' | 'borderless' | 'fullscreen';
  titleBar?: boolean;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  alwaysOnTopLevel?: string;           // 置顶级别，如 'screen-saver'、'floating'
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;            // 默认 true；子窗口默认可全屏
  focusable?: boolean;                 // false 时窗口不抢焦点
  skipTaskbar?: boolean;               // 请求不出现在 Dock/任务栏；macOS 仍可能显示 Mulby 应用级 Dock 图标
  enableLargerThanScreen?: boolean;    // 允许窗口大于屏幕
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  inheritWindowSizeLimits?: boolean;   // 默认 false；true 时 min/max 尺寸约束回退到 manifest.window
  opacity?: number;
  transparent?: boolean;
  backgroundThrottling?: boolean;      // 默认 true；false 时禁用后台 timer/repaint 节流
  visibleOnAllWorkspaces?: boolean;    // 全桌面可见
  visibleOnFullScreen?: boolean;       // 全屏应用上方可见（macOS）
  ignoreMouseEvents?: boolean;         // 鼠标事件穿透
  forwardMouseEvents?: boolean;        // 穿透时仍转发 move 事件（用于 hover 检测）
  params?: Record<string, string>;
}

interface ChildWindowHandle {
  id: number;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
  focus(): Promise<void>;
  showInactive(): Promise<void>;       // 显示但不抢焦点
  setTitle(title: string): Promise<void>;
  setSize(width: number, height: number): Promise<void>;
  setPosition(x: number, y: number): Promise<void>;
  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): Promise<boolean>;
  getBounds(): Promise<{ x: number; y: number; width: number; height: number }>;
  setOpacity(opacity: number): Promise<void>;
  setBackgroundThrottling(allowed: boolean): Promise<boolean>;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<void>;
  setAlwaysOnTop(flag: boolean, level?: string): Promise<void>;
  setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): Promise<void>;
  setFullScreen(flag: boolean): Promise<void>;
  postMessage(channel: string, ...args: unknown[]): Promise<void>;
}
```

默认 `loadMode: 'route'`。`url` 支持路由名（如 `overlay`、`/overlay`）和旧写法（如 `/index.html#overlay?showClicks=true`）。宿主会将路由解析为 `location.hash`，将 query 解析为 `location.search`，并把 `options.params` 透传到子窗口的 `onPluginInit()`。

> 注意：默认路由模式下，`window.create()` 的 `url` 不是 HTML 文件路径，也不会用于选择或加载另一个 UI 文件。子窗口始终加载当前插件 `manifest.ui` 指定的同一个前端入口（通常是 `ui/index.html`）；`url` 只负责传递 hash/query 路由。多页面 UI 应优先在这个入口内部用前端路由处理。

**旧插件兼容模式：多 HTML / 多 preload**

`loadMode: 'file'` 用于迁移 zTools/uTools 旧插件的多文件窗口结构，不建议新插件优先使用。启用后，`url` 会被解释为当前插件目录内的 HTML 文件路径，可带 query/hash：

```javascript
const region = await window.mulby.window.create('region/index.html?key=abc', {
  loadMode: 'file',
  preload: 'region/preload.cjs',
  width: 640,
  height: 480,
  title: 'Region Select',
});
```

文件模式约束：

- HTML 入口必须是插件目录内的相对路径，只允许 `.html` / `.htm`，禁止绝对路径、`../` 越界和 NUL 字符。
- `preload` 仅在 `loadMode: 'file'` 时生效；必须是插件目录内的 `.js` / `.cjs` 文件。未指定时回退到 `manifest.preload`，没有 manifest preload 时只加载 Mulby 核心 preload。
- Mulby 会先加载核心 preload 暴露 `window.mulby`，再加载该窗口指定的插件 preload。
- 文件窗口仍归属创建它的 pluginId，父子窗口控制和消息通信仍受当前插件边界限制。
- 使用 Mulby CLI 打包时，应把额外 HTML、窗口 preload、`.node` 原生模块、`.exe`、`aperture` 等运行资源列入 `manifest.assets`，确保它们进入 `.inplugin`。

子窗口默认不会继承 `manifest.window` 中的 `minWidth`、`minHeight`、`maxWidth`、`maxHeight`，避免主插件面板的尺寸约束限制 overlay、截图、取色器等辅助窗口。需要沿用 manifest 尺寸约束时，显式传入 `inheritWindowSizeLimits: true`。

子窗口的 `fullscreenable` 默认为 `true`，即子窗口默认允许进入全屏（与主插件面板仅在 `type: 'fullscreen'` 时全屏的行为不同）。不需要全屏的子窗口可显式传入 `fullscreenable: false`。

子窗口的 `backgroundThrottling` 解析优先级为 `options.backgroundThrottling ?? manifest.window.backgroundThrottling ?? true`。

在 macOS 上，`skipTaskbar` 不能保证隐藏 Mulby 的 Dock 图标。Dock 是应用级表示；只要存在独立插件窗口或子窗口，Mulby 可能保持 Dock 可见，并在菜单中按插件聚合提供窗口操作。

**Overlay 窗口典型用法：**

```javascript
const display = await window.mulby.screen.getPrimaryDisplay();
const overlay = await window.mulby.window.create('overlay', {
  x: display.bounds.x,
  y: display.bounds.y,
  width: display.bounds.width,
  height: display.bounds.height,
  transparent: true,
  type: 'borderless',
  alwaysOnTop: true,
  alwaysOnTopLevel: 'screen-saver',
  focusable: false,
  skipTaskbar: true,
  enableLargerThanScreen: true,
  ignoreMouseEvents: true,
  forwardMouseEvents: true,
  visibleOnAllWorkspaces: true,
  visibleOnFullScreen: true,
  backgroundThrottling: false,
});
```

> 安全约束：子窗口控制方法仅允许操作当前插件自身创建的 child window，宿主会校验 pluginId 一致性。

### sendToParent(channel, ...args)
[Renderer]
向父窗口发送消息。

### onChildMessage(callback)
[Renderer]
监听子窗口发来的消息。回调签名：`(channel: string, ...args: unknown[]) => void`。

除了插件自行通过 `sendToParent()` 或 `postMessage()` 发送的自定义消息外，宿主还会自动推送以下内置事件：

**`child-window-closed`** — 子窗口关闭时自动通知父窗口。

```typescript
window.mulby.window.onChildMessage((channel, ...args) => {
  if (channel === 'child-window-closed') {
    const payload = args[0] as {
      id: number           // 已关闭子窗口的 window ID
      pluginId: string     // 所属插件 ID
      featureCode: string  // 关联的 feature code
      at: number           // 关闭时间戳 (ms)
    }
    console.log('子窗口已关闭:', payload.id)
  }
})
```

### findInPage(text, options?)
[Renderer]
在页面内查找文本。

### stopFindInPage(action?)
[Renderer]
停止页面内查找。

### startDrag(filePath)
[Renderer]
触发系统原生文件拖拽。

### getOpacity()
[Renderer]
获取当前窗口透明度（0-1）。

### setOpacity(opacity)
[Renderer]
设置窗口透明度（0-1）。

### onWindowStateChange(callback)
[Renderer]
监听窗口最大化状态变化事件。

### subInput.set(placeholder?, isFocus?, options?)
[Renderer]
显示子输入框并设置占位与焦点。仅附着模式可用。

当 subInput 激活时，宿主搜索框和附着插件视为一个整体：文本输入留在搜索框，导航键自动转发给插件。

```javascript
// 基本用法：零配置即获得默认导航键转发
await window.mulby.subInput.set('输入关键词搜索...', true);

// 声明额外转发键（与默认键合并）
await window.mulby.subInput.set('输入关键词搜索...', true, {
  forwardKeys: ['ArrowRight']
});
```

**参数**:
- `placeholder` (string, 可选) - 占位文本，默认 `'请输入...'`
- `isFocus` (boolean, 可选) - 是否自动聚焦，默认 `true`
- `options` (object, 可选) - 配置选项
  - `forwardKeys` (string[], 可选) - 需要额外转发的键名数组，会与默认转发键合并

**默认转发键**: `ArrowDown`, `ArrowUp`, `Enter`, `Tab`, `Escape`, `PageDown`, `PageUp`

这些键在单行搜索框中无实际输入用途，宿主会自动拦截并通过 IPC 转发给拥有 subInput 的插件。修饰键（Shift、Ctrl 等）会随事件一起传递。

若插件需要额外的键（如 `ArrowRight` 用于打开菜单），通过 `forwardKeys` 声明。注意 `ArrowRight`/`ArrowLeft`/`Home`/`End` 在搜索框中有光标移动用途，不会默认转发。

**返回值**: `boolean` - 是否成功启用

### subInput.remove()
[Renderer]
移除子输入框，还原宿主搜索框。

### subInput.setValue(text)
[Renderer]
设置子输入框内容。

### subInput.focus()
[Renderer]
聚焦子输入框（将焦点从插件还给宿主搜索框）。

### subInput.blur()
[Renderer]
取消子输入框焦点。

### subInput.select()
[Renderer]
选中子输入框全部文本。

### subInput.onChange(callback)
[Renderer]
监听子输入框文本变化。当用户在宿主搜索框中输入时触发。

```javascript
const dispose = window.mulby.subInput.onChange(({ text }) => {
  console.log('用户输入:', text);
});
// 取消监听
dispose();
```

**参数**:
- `callback` (function) - 回调函数，接收 `{ text: string }`

**返回值**: `() => void` - 取消监听函数

### subInput.onKeyDown(callback)
[Renderer]
监听从宿主搜索框转发的键盘事件。当用户在 subInput 中按下已注册的转发键时触发。

```javascript
const dispose = window.mulby.subInput.onKeyDown(({ key, shift, ctrl, alt, meta }) => {
  if (key === 'ArrowDown') {
    // 选中下一项
  } else if (key === 'Enter') {
    // 打开选中项
  } else if (key === 'ArrowDown' && shift) {
    // Shift+ArrowDown 多选
  }
});
// 取消监听
dispose();
```

**参数**:
- `callback` (function) - 回调函数，接收 `{ key: string, shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean }`

**返回值**: `() => void` - 取消监听函数

### mulbyMain.subInput.onEnabled(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框启用事件。回调数据包含 `placeholder`、`isFocus` 和 `forwardKeys`。

### mulbyMain.subInput.onDisabled(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框移除事件。

### mulbyMain.subInput.onSetValue(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框设值事件。

### mulbyMain.subInput.onFocus(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框聚焦事件。

### mulbyMain.subInput.onBlur(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框失焦事件。

### mulbyMain.subInput.onSelect(callback)
[Renderer - 主窗口侧]
主窗口侧监听子输入框选中文本事件。

### mulbyMain.subInput.sendChange(text)
[Renderer - 主窗口侧]
主窗口向主进程发送输入变更（转发给插件）。

### mulbyMain.subInput.sendKeyDown(key, modifiers)
[Renderer - 主窗口侧]
主窗口向主进程发送键盘事件（转发给插件）。当 subInput 启用且用户按下 `forwardKeys` 中的键时，SearchInput 会自动调用此方法。

**参数**:
- `key` (string) - 键名，如 `'ArrowDown'`、`'Enter'`
- `modifiers` (object) - 修饰键状态 `{ shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean }`

### mulbyMain.clipboard.onAutoPaste(callback)
[Renderer]
主窗口侧监听 `clipboard:autoPaste` 事件。

### invalidate()
[Renderer]
重绘窗口，可用于解决 Windows 下的一些显示伪影问题。

### 完整示例

```javascript
// 基础子窗口
const child = await window.mulby.window.create('settings', {
  width: 800,
  height: 600,
  params: { showClicks: 'true' },
});
child?.postMessage('ready');

// Overlay 窗口（录屏标记、取色器等场景）
const display = await window.mulby.screen.getPrimaryDisplay();
const overlay = await window.mulby.window.create('overlay', {
  x: display.bounds.x,
  y: display.bounds.y,
  width: display.bounds.width,
  height: display.bounds.height,
  transparent: true,
  type: 'borderless',
  alwaysOnTop: true,
  alwaysOnTopLevel: 'screen-saver',
  focusable: false,
  skipTaskbar: true,
  ignoreMouseEvents: true,
  forwardMouseEvents: true,
  visibleOnAllWorkspaces: true,
  visibleOnFullScreen: true,
  backgroundThrottling: false,
});

// 动态切换穿透状态（如需要交互时临时关闭穿透）
await overlay?.setIgnoreMouseEvents(false);
// 操作完毕后恢复穿透
await overlay?.setIgnoreMouseEvents(true, { forward: true });

// detached 主窗口透明区域点击穿透（如桌面宠物）
window.mulby.window.setIgnoreMouseEvents(true, { forward: true });

// 录制开始时禁用当前控制面板节流，结束/卸载时恢复默认
await window.mulby.window.setBackgroundThrottling(false);
await window.mulby.window.setBackgroundThrottling(true);

// 监听子窗口关闭事件
window.mulby.window.onChildMessage((channel, ...args) => {
  if (channel === 'child-window-closed') {
    const { id, pluginId, featureCode, at } = args[0];
    console.log(`子窗口 ${id} 已关闭`);
  }
});

// 子输入框（附着模式）
await window.mulby.subInput.set('搜索文件...', true, { forwardKeys: ['ArrowRight'] });
window.mulby.subInput.onChange(({ text }) => doSearch(text));
window.mulby.subInput.onKeyDown(({ key, shift }) => {
  if (key === 'ArrowDown') selectNext(shift);
  else if (key === 'ArrowUp') selectPrev(shift);
  else if (key === 'Enter') openSelected();
});
```
