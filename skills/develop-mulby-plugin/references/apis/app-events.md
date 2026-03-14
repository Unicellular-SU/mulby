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

所有方法均返回“取消订阅函数”。
