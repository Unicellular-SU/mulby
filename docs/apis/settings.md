# Settings API (settings)

> 入口：`window.mulby.settings`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/settings.ts`

## 方法

### get()
获取完整设置与快捷键注册状态。

### update(partial)
增量更新设置。

### reset()
恢复默认设置。

### pauseShortcuts()
暂停全局快捷键注册。

### resumeShortcuts()
恢复全局快捷键注册。

## 示例

```ts
const current = await window.mulby.settings.get()
await window.mulby.settings.update({ tray: { enabled: true, closeToTray: true, clickAction: 'toggleWindow' } })
```
