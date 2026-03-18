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

### setExpendHeight(height, allowResize?)
[Renderer]
仅调整窗口高度。

### center()
[Renderer]
窗口居中。

### setAlwaysOnTop(flag)
[Renderer]
设置窗口置顶状态。

### setOpacity(opacity)
[Renderer]
设置窗口透明度（0.0 完全透明 ~ 1.0 完全不透明）。返回 `Promise<void>`。

> macOS 和 Windows 支持，Linux 不支持。

### getOpacity()
[Renderer]
获取当前窗口透明度，返回 `Promise<number>`。

### detach()
[Renderer]
将插件窗口分离为独立窗口。

### close()
[Renderer]
关闭当前插件窗口。

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
获取窗口状态：`{ isMaximized: boolean; isAlwaysOnTop: boolean; opacity: number }`。

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

**options 参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| width | number | 窗口宽度 |
| height | number | 窗口高度 |
| title | string | 窗口标题 |
| type | string | 窗口类型：`default`（带标题栏）、`borderless`（无边框）、`fullscreen`（全屏） |
| titleBar | boolean | 是否显示 Mulby 标题栏（覆盖 manifest 设置） |
| fullscreen | boolean | 是否全屏 |
| alwaysOnTop | boolean | 是否置顶 |
| resizable | boolean | 是否可调大小 |
| x / y | number | 窗口位置 |
| minWidth / minHeight | number | 最小尺寸 |
| maxWidth / maxHeight | number | 最大尺寸 |
| opacity | number | 初始透明度（0.0 ~ 1.0，运行时可通过 `setOpacity` 调整） |
| transparent | boolean | 窗口背景透明（配合 CSS `background: transparent` 实现穿透效果，仅创建时生效） |

```typescript
interface ChildWindowHandle {
  id: number;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  focus(): Promise<void>;
  setTitle(title: string): Promise<void>;
  setSize(width: number, height: number): Promise<void>;
  setPosition(x: number, y: number): Promise<void>;
  setOpacity(opacity: number): Promise<void>;
  postMessage(channel: string, ...args: unknown[]): Promise<void>;
}
```

**示例：**

```javascript
// 创建标准子窗口
const child = await window.mulby.window.create('/editor', { width: 800, height: 600 });

// 创建无边框悬浮窗
const floater = await window.mulby.window.create('/widget', {
  type: 'borderless',
  width: 300,
  height: 200,
  alwaysOnTop: true
});

// 创建全屏画板
const canvas = await window.mulby.window.create('/canvas', {
  type: 'fullscreen'
});

// 创建半透明悬浮窗
const overlay = await window.mulby.window.create('/overlay', {
  type: 'borderless',
  width: 400,
  height: 300,
  alwaysOnTop: true,
  opacity: 0.8,        // 整个窗口半透明
});

// 创建背景穿透窗口
const transparent = await window.mulby.window.create('/widget', {
  type: 'borderless',
  transparent: true,    // CSS transparent 区域可穿透到桌面
  width: 200,
  height: 200,
});

// 运行时调整子窗口透明度
overlay.setOpacity(0.5);
```

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

### 完整示例

```javascript
window.mulby.window.setSize(680, 420);
window.mulby.window.center();

const child = await window.mulby.window.create('https://example.com', { width: 800, height: 600 });
child?.postMessage('ready');

await window.mulby.subInput.set('请输入...', true);
window.mulby.subInput.onChange(({ text }) => console.log(text));

// 透明度控制
await window.mulby.window.setOpacity(0.9);
const opacity = await window.mulby.window.getOpacity();
const state = await window.mulby.window.getState();
console.log(state.opacity); // 0.9
```
