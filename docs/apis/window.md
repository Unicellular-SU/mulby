# 窗口 API (window)
本文档描述 窗口 API (window) 的使用方法与接口。

> 入口：`window.intools.window`

### hide(isRestorePreWindow?)
[Renderer]
隐藏当前窗口（附着/面板/独立窗口）。

### show()
[Renderer]
显示当前窗口，并在必要时恢复并聚焦。

### setSize(width, height)
[Renderer]
设置窗口大小。

### setExpendHeight(height)
[Renderer]
仅调整窗口高度。

### center()
[Renderer]
将窗口居中。

### setAlwaysOnTop(flag)
[Renderer]
设置窗口置顶状态。

### detach()
[Renderer]
在附着模式下将插件分离为独立窗口。

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
获取窗口状态：`{ isMaximized: boolean; isAlwaysOnTop: boolean }`。

### minimize()
[Renderer]
最小化窗口。

### maximize()
[Renderer]
最大化/还原窗口。

### create(url, options?)
[Renderer]
创建子窗口并返回控制句柄。

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
  postMessage(channel: string, ...args: unknown[]): Promise<void>;
}
```

### sendToParent(channel, ...args)
[Renderer]
向父窗口发送消息。

### onChildMessage(callback)
[Renderer]
监听子窗口发来的消息。

### findInPage(text, options?)
[Renderer]
在页面内查找文字，返回 `requestId`。

### stopFindInPage(action?)
[Renderer]
停止页面内查找。

### startDrag(filePath)
[Renderer]
触发系统原生拖拽（文件必须存在）。

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

### intoolsMain.subInput.onEnabled(callback)
[Renderer]
主窗口监听子输入框启用事件。

### intoolsMain.subInput.onDisabled(callback)
[Renderer]
主窗口监听子输入框移除事件。

### intoolsMain.subInput.onSetValue(callback)
[Renderer]
主窗口监听子输入框设置值事件。

### intoolsMain.subInput.onFocus(callback)
[Renderer]
主窗口监听子输入框聚焦事件。

### intoolsMain.subInput.onBlur(callback)
[Renderer]
主窗口监听子输入框失焦事件。

### intoolsMain.subInput.onSelect(callback)
[Renderer]
主窗口监听子输入框选中事件。

### intoolsMain.subInput.sendChange(text)
[Renderer]
主窗口向主进程发送输入变化（转发给插件）。

### 完整示例

```javascript
// 调整窗口大小并居中
window.intools.window.setSize(680, 420);
window.intools.window.center();

// 创建子窗口
const child = await window.intools.window.create('https://example.com', { width: 800, height: 600 });
child?.postMessage('ready');

// 子输入框
await window.intools.subInput.set('请输入...', true);
window.intools.subInput.onChange(({ text }) => console.log(text));
```