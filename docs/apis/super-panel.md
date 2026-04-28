# Super Panel API (superPanel)

> 提供给超级面板前端 (Super Panel) 使用的控制和状态交互接口，通过 `window.mulby.superPanel` 命名空间访问。

## 方法列表

### `getState()`
获取当前超级面板的状态（包含位置、可见性、固定应用列表、剪贴板快照、即时翻译结果等）。
* **返回**：`Promise<SuperPanelState>`

### `action(action, payload?)`
向主进程发送具体的控制指令或执行功能。
* **参数**：
  * `action` (string) - 动作名称，例如：
    * `'trigger'` - 触发相关动作
    * `'focus'` - 面板获得焦点
    * `'blur'` - 面板失去焦点
    * `'copyTranslation'` - 显式复制当前翻译内容到剪贴板，带有 `{ text: string }` 参数
    * `'translationToggle'` - 展开或折叠长翻译内容，带有 `{ expanded: boolean, height?: number }` 参数
  * `payload` (Record<string, unknown>, optional) - 动作所需的参数数据
* **返回**：`Promise<{ success: boolean; error?: string }>`

### `close()`
主动关闭/隐藏超级面板，并还原之前保存的剪贴板内容（除非用户显式执行过复制操作中断恢复流程）。
* **返回**：`Promise<void>`

### `setIgnoreBlur(ignore)`
控制超级面板是否临时忽略失焦关闭逻辑。用于面板内部打开菜单、弹窗或系统选择器时避免窗口因 blur 被立即隐藏。
* **参数**：
  * `ignore` (boolean) - `true` 表示暂时忽略 blur，`false` 表示恢复正常 blur 行为
* **返回**：`Promise<unknown>`

### `onState(callback)`
监听主进程推送的最新面板状态。当位置改变、有新内容或者翻译加载完毕时会触发。
* **参数**：
  * `callback` ((state: SuperPanelState) => void) - 状态更新回调函数
* **返回**：`() => void` （用于移除监听的清理函数）

## 使用示例

### 处理翻译复制

由于在没有用户焦点的窗口环境中，调用浏览器原生剪贴板 API (`navigator.clipboard`) 往往由于权限原因会静默失败。超级面板必须通过调用 `action('copyTranslation')` 交由主进程借助 Electron 原生功能来完成剪贴板写入。

```javascript
window.mulby.superPanel.action('copyTranslation', { text: 'Translated text' }).then(result => {
  if (result.success) {
    console.log('复制成功');
  } else {
    console.error('复制失败:', result.error);
  }
});
```

### 监听状态更新

```javascript
const unsubscribe = window.mulby.superPanel.onState((newState) => {
  console.log('收到最新面板状态：', newState);
  // 更新前端 UI 控制逻辑...
});

// 在组件卸载时清理监听器
// unsubscribe();
```
