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

### 完整示例

```javascript
window.mulby.window.setSize(680, 420);
window.mulby.window.center();

const child = await window.mulby.window.create('https://example.com', { width: 800, height: 600 });
child?.postMessage('ready');

await window.mulby.subInput.set('请输入...', true);
window.mulby.subInput.onChange(({ text }) => console.log(text));
```
