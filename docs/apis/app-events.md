# App Events API (app)

> 入口：`window.mulby.app`
> 代码来源：`src/preload/index.ts`

该模块用于主进程向渲染进程派发导航/系统事件。

## 事件订阅方法

- `onOpenSystemPlugin(callback)`
- `onSystemPluginBeforeAttach(callback)`
- `onOpenAiSettings(callback)`
- `onOpenAiMcpSettings(callback)`
- `onOpenAiSkillsSettings(callback)`
- `onOpenPluginStore(callback)`
- `onOpenPluginManager(callback)`
- `onOpenBackgroundPlugins(callback)`
- `onOpenTaskScheduler(callback)`
- `onOpenLogViewer(callback)`
- `onOpenCommandShortcuts(callback)`

所有方法均返回"取消订阅函数"。

## 插件生命周期事件

### onPluginOut(callback)
[Renderer]

当插件 UI 即将关闭/退出时触发。

```javascript
const unsubscribe = window.mulby.onPluginOut((isKill) => {
  if (isKill) {
    // 强制退出（如插件被禁用、Mulby 退出）
    console.log('Plugin force killed');
  } else {
    // 正常关闭（如用户关闭窗口、按 Esc）
    saveState();
    console.log('Plugin closed normally');
  }
});

// 取消监听
unsubscribe();
```

**参数**:
- `callback` (function) - 回调函数，参数 `isKill: boolean`
  - `true`：强制退出（插件被禁用、应用退出等）
  - `false`：正常关闭（用户关闭、Esc 退出等）

**返回值**: `() => void` — 取消订阅函数

> 适用于在插件退出时保存状态、清理资源。回调执行时间有限，避免耗时操作。
