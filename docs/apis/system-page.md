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
- `storage-explorer`
- `ai-settings`
- `ai-mcp-settings`
- `ai-tools-settings`
- `ai-skills-settings`

`payload` 还支持以下可选字段（仅在对应 `page` 下生效，其他 `page` 会被忽略）：

| 字段 | 适用 page | 说明 |
|------|-----------|------|
| `settingsSection` | `settings` | 打开后定位到的设置分区；非法值回退到 `dashboard` |
| `shortcutCommandHint` | `settings` | 命令快捷键采集提示（配合命令快捷键分区） |
| `detailsPluginId` | `plugin-manager` | 打开后直接展示该插件的详情 |
| `storeFilter` | `plugin-store` | 目前仅支持 `'updatable'`，打开后筛选可更新插件 |

### close()
关闭系统页面。

### detach()
将系统页面分离为独立窗口。

### reload()
刷新系统页面。

### showMenu(point?)
在系统页面所在窗口弹出右键菜单。
- 入参：`point?: { x: number; y: number }`
- 返回：`Promise<boolean>`

### getMode()
获取当前模式：`none | attached | detached`。

### getState()
获取页面状态（是否打开、模式、页面标识、标题）。

### onStateChange(callback)
监听状态变化。

## 示例

```ts
await window.mulby.systemPage.open({ page: 'settings', settingsSection: 'general' })
await window.mulby.systemPage.open({ page: 'plugin-store', storeFilter: 'updatable' })
```
