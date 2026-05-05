# 窗口 API (window)
本文档描述窗口 API (window) 的使用方式与接口。

> 入口：`window.mulby.window`

### hide(isRestorePreWindow?)
[Renderer]
隐藏当前窗口。

### show()
[Renderer]
显示当前窗口。

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

### setAlwaysOnTop(flag)
[Renderer]
设置窗口置顶状态。

### detach()
[Renderer]
将插件窗口分离为独立窗口。

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
  type?: 'default' | 'borderless' | 'fullscreen';
  titleBar?: boolean;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  alwaysOnTopLevel?: string;           // 置顶级别，如 'screen-saver'、'floating'
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;
  focusable?: boolean;                 // false 时窗口不抢焦点
  skipTaskbar?: boolean;               // 不出现在 Dock/任务栏
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
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<void>;
  setAlwaysOnTop(flag: boolean, level?: string): Promise<void>;
  setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): Promise<void>;
  setFullScreen(flag: boolean): Promise<void>;
  postMessage(channel: string, ...args: unknown[]): Promise<void>;
}
```

`url` 支持路由名（如 `overlay`、`/overlay`）和旧写法（如 `/index.html#overlay?showClicks=true`）。宿主会将路由解析为 `location.hash`，将 query 解析为 `location.search`，并把 `options.params` 透传到子窗口的 `onPluginInit()`。

> 注意：`window.create()` 的 `url` 不是 HTML 文件路径，也不会用于选择或加载另一个 UI 文件。子窗口始终加载当前插件 `manifest.ui` 指定的同一个前端入口（通常是 `ui/index.html`）；`url` 只负责传递 hash/query 路由。多页面 UI 应在这个入口内部用前端路由处理。

子窗口默认不会继承 `manifest.window` 中的 `minWidth`、`minHeight`、`maxWidth`、`maxHeight`，避免主插件面板的尺寸约束限制 overlay、截图、取色器等辅助窗口。需要沿用 manifest 尺寸约束时，显式传入 `inheritWindowSizeLimits: true`。

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
});
```

> 安全约束：子窗口控制方法仅允许操作当前插件自身创建的 child window，宿主会校验 pluginId 一致性。

### sendToParent(channel, ...args)
[Renderer]
向父窗口发送消息。

### onChildMessage(callback)
[Renderer]
监听子窗口发来的消息。

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

### subInput.set(placeholder?, isFocus?)
[Renderer]
显示子输入框并设置占位与焦点。

### subInput.remove()
[Renderer]
移除子输入框。

### subInput.setValue(text)
[Renderer]
设置子输入框内容。

### subInput.focus()
[Renderer]
聚焦子输入框。

### subInput.blur()
[Renderer]
取消子输入框焦点。

### subInput.select()
[Renderer]
选中子输入框文本。

### subInput.onChange(callback)
[Renderer]
监听子输入框文本变化。

### mulbyMain.subInput.onEnabled(callback)
[Renderer]
主窗口侧监听子输入框启用事件。

### mulbyMain.subInput.onDisabled(callback)
[Renderer]
主窗口侧监听子输入框移除事件。

### mulbyMain.subInput.onSetValue(callback)
[Renderer]
主窗口侧监听子输入框设值事件。

### mulbyMain.subInput.onFocus(callback)
[Renderer]
主窗口侧监听子输入框聚焦事件。

### mulbyMain.subInput.onBlur(callback)
[Renderer]
主窗口侧监听子输入框失焦事件。

### mulbyMain.subInput.onSelect(callback)
[Renderer]
主窗口侧监听子输入框选中文本事件。

### mulbyMain.subInput.sendChange(text)
[Renderer]
主窗口向主进程发送输入变更（转发给插件）。

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
});

// 动态切换穿透状态（如需要交互时临时关闭穿透）
await overlay?.setIgnoreMouseEvents(false);
// 操作完毕后恢复穿透
await overlay?.setIgnoreMouseEvents(true, { forward: true });

// 子输入框
await window.mulby.subInput.set('请输入...', true);
window.mulby.subInput.onChange(({ text }) => console.log(text));
```
