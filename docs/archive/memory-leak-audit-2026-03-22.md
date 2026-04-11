# Mulby 内存泄漏与内存优化审查报告

**审查时间**: 2026-03-22
**审查范围**: 主进程生命周期、插件生命周期（启停）、宿主进程管理、窗口管理、Worker 管理、事件监听器、定时器管理
**审查方法**: 静态代码分析（覆盖 `src/main/plugin/`, `src/main/browser/`, `src/main/services/` 关键模块）

---

## 总体评估

项目整体的内存管理 **较为健壮**，关键路径（插件 Host 销毁、窗口关闭清理、定时器清除）已实现了显式的资源释放逻辑。但存在 **若干可优化的边缘场景**，逐条分析如下。

---

## 🔴 潜在泄漏风险

### 1. `createPluginAPI` 每次 API 调用时创建新实例

**文件**: [host-manager.ts](file:///Users/su/workspace/mulby/src/main/plugin/host-manager.ts#L364-L370) (line 364) & [host-manager.ts](file:///Users/su/workspace/mulby/src/main/plugin/host-manager.ts#L693-L699) (line 693)

**现象**: `handleApiCall` 和 `invokePluginMethod` 每次收到插件的 API 请求时，都会调用 `createPluginAPI(...)` 创建一个全新的 API 对象。

```typescript
// handleApiCall - 每次 API 调用都创建
const pluginApi = createPluginAPI(
  plugin.id,
  this.messageBus,
  this.taskScheduler,
  this.clipboardHistoryManager,
  { runCommandAllowed: host.runCommandAllowed }
)
```

**分析**:
- `createPluginAPI` 内部会调用 `createPluginGlobalShortcut(pluginName)` 和 `createPluginTray(pluginName)`，这些工厂函数可能注册全局快捷键监听或创建 Tray 实例。
- 虽然 JS GC 会回收临时对象，但如果工厂函数有副作用（注册全局资源），那些资源不会被回收。
- 如果插件频繁调用 API（如 AI 流式调用），会产生大量临时对象。

**风险等级**: ⚠️ 中等（取决于 `createPluginGlobalShortcut`/`createPluginTray` 的实现是否有全局副作用）

**建议**: 为每个 Host 缓存 `pluginAPI` 实例，而不是每次请求创建。可在 `PluginHost` 结构中增加 `cachedApi` 字段。

---

### 2. `pluginFeatureStore.onChange()` 监听器无法移除

**文件**: [dynamic-features.ts](file:///Users/su/workspace/mulby/src/main/plugin/dynamic-features.ts#L129-L131) (line 129) & [manager.ts](file:///Users/su/workspace/mulby/src/main/plugin/manager.ts#L178-L180) (line 178)

**现象**:
```typescript
// PluginFeatureStore
onChange(listener: () => void): void {
  this.changeListeners.push(listener)  // 只有 push，没有 remove 机制
}

// PluginManager 构造函数中注册
pluginFeatureStore.onChange(() => {
  void this.syncSearchWorker().catch(() => {})
})
```

**分析**:
- `pluginFeatureStore` 是模块级单例，生命周期等同于应用。
- `PluginManager` 也是单例，不会被销毁，所以这里 **不会实际泄漏**。
- 但如果未来 `PluginManager` 支持重建或热替换，`onChange` 缺失 `offChange` 方法会导致监听器累积。

**风险等级**: ⚡ 低（当前无泄漏，但设计上应补充 `offChange`）

---

### 3. `BackgroundPluginManager` 的 Watchdog 事件监听

**文件**: [background-manager.ts](file:///Users/su/workspace/mulby/src/main/plugin/background-manager.ts#L57-L86) (line 57-86)

**现象**: `BackgroundPluginManager` 在构造函数中向 `watchdog` 注册了 4 个事件监听器（`host:unresponsive`、`host:memory-exceeded`、`host:error-threshold`、`host:memory-leak-warning`），但在 `stopAll()` 和 `shutdown()` 中 **未移除这些监听器**。

**分析**:
- `BackgroundPluginManager` 是单例，与app生命周期一致，因此 **当前不会泄漏**。
- 但如果 `PluginManager.destroy()` 后重建（如热重载场景），旧的 `BackgroundPluginManager` 的监听器仍会挂在 `watchdog` 上。

**风险等级**: ⚡ 低（单例模式下无泄漏，但应在 `shutdown()` 中清理事件）

---

### 4. InBrowserWindow 的 Session 清理竞态

**文件**: [InBrowserWindow.ts](file:///Users/su/workspace/mulby/src/main/browser/InBrowserWindow.ts#L26-L30) (line 26-30)

**现象**:
```typescript
if (this.cleanupSessionOnClose) {
  this.window.once('closed', () => {
    void this.cleanupSessionData()  // 异步清理，fire-and-forget
  })
}
```

**分析**:
- Session 清理是异步的（`clearCache()`, `clearStorageData()` 等），但 `closed` 事件后是 fire-and-forget。
- 如果应用在 Session 清理完成前退出，可能留下临时 partition 数据。
- 更重要的是，每次创建 InBrowser 窗口都会用 `inbrowser-${timestamp}` 生成新 partition，这些 partition 对应磁盘上的存储路径。如果清理失败，**磁盘上会残留临时文件**（非内存泄漏，但属于存储泄漏）。

**风险等级**: ⚠️ 中等（磁盘残留，非内存泄漏）

---

## 🟡 内存优化建议

### 5. `lastSyncedPlugins` 持有完整的插件特征数据副本

**文件**: [search-worker-manager.ts](file:///Users/su/workspace/mulby/src/main/plugin/search-worker-manager.ts#L28) (line 28)

**现象**: `PluginSearchWorker.lastSyncedPlugins` 缓存了最新的完整插件搜索数据用于 Worker 重启恢复：
```typescript
private lastSyncedPlugins: SearchPluginData[] | null = null
```

**分析**: 这是主进程中唯一显式缓存完整插件特征数据的地方。如果插件数量多、特征复杂，这份数据可能占用不少内存。但它是必要的（Worker 崩溃重启后需要恢复数据）。

**建议**: 可以考虑使用弱引用或在 Worker 稳定运行后释放缓存，需要时从 `PluginManager` 重新构建。

---

### 6. MessageBus 的 messageHistory 无界增长

**文件**: [message-bus.ts](file:///Users/su/workspace/mulby/src/main/plugin/message-bus.ts#L30-L31) (line 30-31)

**现象**:
```typescript
private messageHistory: PluginMessage[] = []
private maxHistorySize = 100  // 最多保留 100 条历史消息
```

**分析**: 已限制为 100 条，**低风险**。但 `PluginMessage.payload` 是 `unknown` 类型，如果插件传递大型 payload（如图片 base64），100 条也可能占用大量内存。

**建议**: 可以考虑限制单条消息的 payload 大小，或者只存储消息元数据（不含 payload），在查询时按需获取。

---

### 7. Watchdog 内存历史记录的大小

**文件**: [watchdog.ts](file:///Users/su/workspace/mulby/src/main/plugin/watchdog.ts#L220-L226) (line 220-226)

**现象**: 每个被监控的 Host 插件都维护一个 `memoryHistory` 数组（默认 12 条）。
```typescript
health.memoryHistory.push({ timestamp: now, memory: memoryMB })
if (health.memoryHistory.length > maxSize) {
  health.memoryHistory.shift()  // 滑动窗口
}
```

**分析**: 已实现滑动窗口，**低风险**。`unregisterHost` 时也会清理 `memoryHistory = []`。

---

### 8. `createPluginAPI` 中的模块级单例

**文件**: [api.ts](file:///Users/su/workspace/mulby/src/main/plugin/api.ts#L35-L37) (line 35-37)

**现象**:
```typescript
const pluginStorage = new PluginStorage()
const pluginFilesystem = new PluginFilesystem()
const pluginHttp = new PluginHttp()
```

**分析**: 这些是模块级单例，在进程启动时创建，生命周期等同于应用。它们被所有插件共享，**不会泄漏**，但如果这些类内部缓存了数据（如 Storage 的 DB 连接、Http 的连接池），需要确认在应用退出时被正确关闭。

---

## ✅ 已确认正常的模块

| 模块 | 分析 |
|------|------|
| `PluginHostManager.cleanupHost()` | ✅ 正确清理了 watchdog、messageBus、pendingRequests、hosts Map |
| `PluginHostManager.waitForReady()` | ✅ 在超时和成功时都 `off('host:ready', onReady)` |
| `PluginHostManager.sendRequest()` | ✅ `pendingRequests` 在响应/超时时都正确 delete 和 `clearTimeout` |
| `PluginManager.resetRuntimeForInit()` | ✅ 清理 watchers、关闭窗口、停止后台、销毁 hosts、清空 maps |
| `PluginManager.disable()` | ✅ 停止后台、停止 watcher、关闭窗口、调用钩子、销毁 Host、清理状态 |
| `PluginManager.uninstall()` | ✅ 完整的资源清理链路，包括文件删除和状态清理 |
| `PluginManager.destroy()` | ✅ 清理 watchers、关闭后台、销毁 hosts、销毁 searchWorker |
| `PluginPanelWindow.cleanup()` | ✅ 清理定时器、移除位置同步监听、关闭阴影窗口、置空引用 |
| `PluginPanelWindow.removePositionSync()` | ✅ 正确移除了 mainWindow 上的 move/resize/will-move 监听 |
| `PluginWindowManager.closeAll()` | ✅ 关闭附着插件和所有独立窗口，清空 map |
| `PluginWindowManager.detachedWindows` | ✅ 窗口 `closed` 事件中正确 delete，并触发 Dock 更新 |
| `SearchWorker.destroy()` | ✅ reject 所有 pending、清理 ready 状态、kill worker |
| `SearchWorker.rejectAllPending()` | ✅ 遍历 pending，clearTimeout + reject + delete |
| `Watchdog.stop()` | ✅ clearInterval + null |
| `Watchdog.unregisterHost()` | ✅ 清理 memoryHistory + delete from hosts |
| `BackgroundPluginManager.stop()` | ✅ 清理 runtimeTimer、从 map 删除、注销 watchdog、销毁 host |
| `InBrowserManager.releaseWindow()` | ✅ 正确清理了 windows、windowOwners、ownerToWindows 三个 Map |
| `InBrowserManager.destroyAll()` | ✅ destroy 所有窗口并 clear 三个 Map |
| 文件监听(FSWatcher) | ✅ `stopPluginWatcher` 正确关闭 watcher 和清理 debounce 定时器 |

---

## 📊 运行时内存占用评估

### 常驻内存消耗点

| 项目 | 估算规模 | 说明 |
|------|----------|------|
| `PluginManager.plugins` Map | 低 | 每个插件约几 KB 的 manifest 元数据 |
| `SearchWorker.lastSyncedPlugins` | 中 | 所有插件特征数据的完整副本 |
| `PluginFeatureStore.data` | 低 | 动态特征 JSON，持久化到磁盘 |
| `MessageBus.messageHistory` | 低~中 | 最多 100 条，取决于 payload 大小 |
| `UtilityProcess` 进程（每个活跃插件） | 高 | 每个 Host 约 30-80MB，视插件复杂度 |
| `BrowserWindow` 实例 | 高 | 每个窗口约 50-150MB，视页面复杂度 |
| `FSWatcher`（开发模式） | 极低 | 每个 watcher 几 KB |

### 优化空间最大的区域

1. **UtilityProcess 闲置回收**: 当前插件 Host 一旦创建就一直存活直到插件被禁用/卸载。对于非后台运行的插件，可以在窗口关闭后一段时间（如 5 分钟无请求）自动销毁 Host，下次使用时再懒加载。这是 **最大的优化空间**。

2. **BrowserWindow 复用**: InBrowser 模块已实现了窗口复用（通过 ID），但插件窗口目前是一次性的。可以考虑对同一插件的窗口做缓存复用。

---

## 总结

| 类别 | 数量 | 说明 |
|------|------|------|
| 🔴 潜在泄漏风险 | 4 | 主要集中在 API 对象频繁创建和事件监听器清理 |
| 🟡 内存优化建议 | 4 | 缓存策略和数据大小限制 |
| ✅ 已确认安全 | 17+ | 关键清理路径均实现正确 |

**核心结论**: 当前代码 **不会导致严重、持续的内存泄漏**，但存在可优化的边缘场景。最大的内存占用来自 UtilityProcess 和 BrowserWindow，建议实现「闲置 Host 自动回收」以降低长时间运行时的内存占用。
