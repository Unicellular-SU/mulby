## 4. 窗口 API (window)

### 4.1 setSize(width, height)
设置插件窗口大小。

```javascript
await window.setSize(600, 400);
```

### 4.2 hide()
隐藏主窗口。

```javascript
await window.hide();
```

### 4.3 startDrag(filePath)
从插件窗口发起系统级文件拖拽。

使用要点：
- `filePath` 必须是本地真实存在的文件路径。
- 必须在 `dragstart` 事件中调用。
- 不要设置 `text/plain` 的拖拽数据，否则在 macOS 上会生成 `.textClipping`。

```javascript
// 示例：在可拖拽元素上触发
const el = document.getElementById('drag-handle')
el.setAttribute('draggable', 'true')
el.addEventListener('dragstart', (e) => {
  e.preventDefault() // 阻止默认 DOM 拖拽，交给原生拖拽
  window.startDrag('/Users/su/Downloads/111.txt')
})
```

```javascript
// 示例：生成临时文件后拖拽
const tempDir = await system.getPath('temp')
const path = `${tempDir}/intools-drag-${Date.now()}.txt`
await filesystem.writeFile(path, 'Hello InTools', 'utf-8')
window.startDrag(path)
```
