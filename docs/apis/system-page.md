# System Page API (systemPage)

> 入口：`window.mulby.systemPage`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/system-page.ts`

## 方法

### open(payload)
打开系统页面。

`payload.page` 支持：
- `settings`
- `plugin-manager`
- `plugin-store`
- `background-plugins`
- `task-scheduler`
- `log-viewer`
- `ai-settings`
- `ai-mcp-settings`
- `ai-skills-settings`

### close()
关闭系统页面。

### detach()
将系统页面分离为独立窗口。

### reload()
刷新系统页面。

### getMode()
获取当前模式：`none | attached | detached`。

### getState()
获取页面状态（是否打开、模式、页面标识、标题）。

### onStateChange(callback)
监听状态变化。

## 示例

```ts
await window.mulby.systemPage.open({ page: 'settings', settingsSection: 'general' })
```
