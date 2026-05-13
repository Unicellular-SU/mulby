# Dialog API (dialog)
本文档描述 Dialog API (dialog) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.dialog`
> - 插件后端：`context.api.dialog`

Dialog API 提供文件选择、保存对话框和消息对话框，支持 macOS、Windows 和 Linux。

### showOpenDialog(options?)
[Renderer] [Backend]
显示打开文件对话框。

```javascript
// 选择单个文件
const files = await dialog.showOpenDialog();

// 选择多个文件
const files = await dialog.showOpenDialog({
  title: '选择文件',
  properties: ['openFile', 'multiSelections']
});

// 选择目录
const dirs = await dialog.showOpenDialog({
  properties: ['openDirectory']
});

// 带文件过滤器
const images = await dialog.showOpenDialog({
  title: '选择图片',
  filters: [
    { name: '图片', extensions: ['jpg', 'png', 'gif'] },
    { name: '所有文件', extensions: ['*'] }
  ]
});
```

**参数** (OpenDialogOptions):
- `title` (string, 可选) - 对话框标题
- `defaultPath` (string, 可选) - 默认路径
- `buttonLabel` (string, 可选) - 确认按钮文字
- `filters` (array, 可选) - 文件过滤器
- `properties` (array, 可选) - 属性：
  - `'openFile'` - 允许选择文件
  - `'openDirectory'` - 允许选择目录
  - `'multiSelections'` - 允许多选
  - `'showHiddenFiles'` - 显示隐藏文件

**返回值**: `string[]` - 选中的文件路径数组，取消时返回空数组

### showSaveDialog(options?)
[Renderer] [Backend]
显示保存文件对话框。

```javascript
const savePath = await dialog.showSaveDialog({
  title: '保存文件',
  defaultPath: 'untitled.txt',
  filters: [
    { name: '文本文件', extensions: ['txt'] }
  ]
});

if (savePath) {
  await filesystem.writeFile(savePath, content);
}
```

**参数** (SaveDialogOptions):
- `title` (string, 可选) - 对话框标题
- `defaultPath` (string, 可选) - 默认文件名或路径
- `buttonLabel` (string, 可选) - 确认按钮文字
- `filters` (array, 可选) - 文件过滤器

**返回值**: `string | null` - 保存路径，取消时返回 null

### showMessageBox(options)
[Renderer] [Backend]
显示消息框。

```javascript
// 简单消息
await dialog.showMessageBox({
  message: '操作完成'
});

// 确认对话框
const result = await dialog.showMessageBox({
  type: 'question',
  title: '确认',
  message: '确定要删除吗？',
  buttons: ['取消', '删除'],
  defaultId: 0,
  cancelId: 0
});

if (result.response === 1) {
  // 用户点击了"删除"
}
```

**参数** (MessageBoxOptions):
- `type` (string, 可选) - 类型：'none' | 'info' | 'error' | 'question' | 'warning'
- `title` (string, 可选) - 标题
- `message` (string, 必需) - 消息内容
- `detail` (string, 可选) - 详细信息
- `buttons` (string[], 可选) - 按钮文字数组，默认 ['OK']
- `defaultId` (number, 可选) - 默认选中按钮索引
- `cancelId` (number, 可选) - 取消按钮索引

**返回值**: `{ response: number; checkboxChecked: boolean }`

### showErrorBox(title, content)
[Renderer] [Backend]
显示错误消息框。该方法使用 Mulby 内部消息框渲染，以便正确绑定调用方窗口并避免被置顶插件窗口遮挡。

```javascript
await dialog.showErrorBox('错误', '发生了一个严重错误');
```

**参数**:
- `title` (string) - 标题
- `content` (string) - 错误内容

**返回值**: `Promise<void>`

### 完整示例

```javascript
// 选择文件
const files = await window.mulby.dialog.showOpenDialog({
  title: '选择文件',
  properties: ['openFile', 'multiSelections']
});
if (files.length) {
  window.mulby.await notification.show(`已选择 ${files.length} 个文件`);
}
```
