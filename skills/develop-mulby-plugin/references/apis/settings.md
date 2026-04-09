# Settings API (settings)

> 入口：`window.mulby.settings`
> 代码来源：`src/preload/apis/platform-api.ts`、`src/main/ipc/settings.ts`

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

### setShortcutRecordingActive(active)
设置“快捷键录制”状态（用于命令快捷键采集）。

### onShortcutCaptured(callback)
监听快捷键采集结果事件。

### getOpenAtLoginState()
获取开机自启状态。

### setOpenAtLogin(enabled)
设置开机自启状态。

### getUpdateCenterState()
获取更新中心状态。

### checkAppUpdates()
手动检查应用更新。

### openUpdateReleasePage()
打开更新发布页。

### downloadUpdate()
下载已发现的新版本更新包。

### installUpdate()
安装已下载的更新并重启应用。

### onUpdateStateChanged(callback)
监听更新状态实时变化（下载进度等）。返回取消监听函数。

### onShortcutStatusChanged(callback)
监听快捷键注册状态变化（后台重试抢回快捷键成功时触发）。返回取消监听函数。

## 示例

```ts
const current = await window.mulby.settings.get()
await window.mulby.settings.update({ tray: { enabled: true, closeToTray: true, clickAction: 'toggleWindow' } })

const off = window.mulby.settings.onShortcutCaptured((accelerator) => {
  console.log('captured:', accelerator)
})

await window.mulby.settings.setShortcutRecordingActive(true)
// ... wait capture
await window.mulby.settings.setShortcutRecordingActive(false)
off()
```
