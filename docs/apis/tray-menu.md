# Tray Menu API (trayMenu)

> 入口：`window.mulby.trayMenu`
> 代码来源：`src/preload/index.ts`、`src/main/services/tray-menu-window.ts`

## 方法

### getState()
获取托盘菜单窗口状态（平台、开机启动状态、运行状态、最近操作等）。

### action(action, payload?)
执行托盘菜单动作。

常见动作（以代码定义为准）：
- `toggleOpenAtLogin`
- `openSettings`
- `openAiSettings`
- `openPluginManager`
- `openBackgroundPlugins`
- `openTaskScheduler`
- `openPluginStore`
- `openLogsDir`
- `reloadPlugins`
- `resetWindowPosition`
- `restartMainProcess`
- `quitMainProcess`

### close()
关闭托盘菜单窗口。

### onState(callback)
监听托盘菜单状态推送。
