# System Plugin API (systemPlugin)

> 入口：`window.mulby.systemPlugin`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/system-plugin.ts`

## 方法

### setActive(pluginId | null)
设置当前激活的系统插件。

### notifyReadyForAttach(requestId)
通知主进程“系统插件已准备好附着”。

### getActive()
获取当前激活的系统插件 ID。
