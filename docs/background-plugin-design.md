# 插件后台运行设计方案

## 1. 概述

### 1.1 目标

允许插件在窗口关闭后继续在后台运行，支持定时任务、监控、同步等场景，同时保证系统资源的合理使用和安全性。

### 1.2 设计原则

- **与现有架构集成**：复用现有的 Watchdog、HostManager、生命周期管理等模块
- **显式声明**：插件必须在 manifest 中声明后台运行权限
- **资源可控**：严格的资源限制和监控，防止滥用
- **用户透明**：用户可以清楚地看到哪些插件在后台运行，并能随时终止
- **性能优先**：避免内存泄漏，优化长时间运行的性能

### 1.3 实现状态

- ✅ **Phase 1 - 基础后台运行**：已完成
- ✅ **Phase 2 - 持久化和恢复**：已完成
- ✅ **Phase 3 - 管理界面**：已完成
- ✅ **Phase 4 - 高级特性**：已完成
  - ✅ 内存泄漏检测
  - ✅ 性能优化
  - ✅ 更细粒度的资源限制
  - ✅ 插件间通信

---

## 2. 架构设计

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    PluginManager                        │
│  - 插件生命周期管理                                      │
│  - 协调 BackgroundPluginManager 和 HostManager          │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ HostManager  │  │ Background       │  │  Watchdog    │
│              │  │ PluginManager    │  │              │
│ - 进程管理   │  │                  │  │ - 资源监控   │
│ - IPC 通信   │  │ - 后台插件注册   │  │ - 心跳检测   │
│              │  │ - 状态跟踪       │  │ - 超时终止   │
└──────────────┘  │ - 持久化恢复     │  └──────────────┘
                  └──────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ PluginState      │
                  │ Manager          │
                  │                  │
                  │ - 状态持久化     │
                  └──────────────────┘
```

### 2.2 模块职责

#### 2.2.1 BackgroundPluginManager（新增）

**职责**：
- 管理后台运行的插件列表
- 跟踪后台插件的运行状态和资源使用
- 处理后台插件的启动、停止、恢复
- 提供查询接口供 UI 展示

**关键方法**：
```typescript
class BackgroundPluginManager {
  // 启动后台插件
  async start(pluginId: string): Promise<boolean>

  // 停止后台插件
  async stop(pluginId: string): Promise<void>

  // 列出所有后台插件
  list(): BackgroundPluginInfo[]

  // 获取插件运行时信息
  getInfo(pluginId: string): BackgroundPluginInfo | null

  // 检查插件是否在后台运行
  isRunning(pluginId: string): boolean

  // 恢复持久化的后台插件（应用启动时）
  async restorePersistent(): Promise<void>
}
```

#### 2.2.2 PluginManager（扩展）

**新增职责**：
- 窗口关闭时判断是否保持后台运行
- 协调 BackgroundPluginManager 和 HostManager
- 处理后台插件的生命周期钩子

**修改点**：
- `run()` 方法：窗口关闭时不销毁后台插件的 Host
- `disable()` 方法：禁用时停止后台运行
- `destroy()` 方法：应用退出时停止所有后台插件

#### 2.2.3 HostManager（扩展）

**新增职责**：
- 支持后台插件的 Host 长时间运行
- 区分前台和后台插件的资源管理策略

**修改点**：
- 后台插件的 Host 始终注册到 Watchdog（不使用 activeRequests 计数）
- 后台插件的 Host 不会因为无活跃请求而被销毁

#### 2.2.4 Watchdog（复用）

**现有能力**：
- 心跳检测（5秒间隔，10秒超时，最多丢失3次）
- 内存监控（默认 512MB）
- 请求速率限制（1000次/分钟）
- 错误率监控（50次/分钟）

**扩展点**：
- 为后台插件配置更严格的资源限制
- 超时自动终止后台插件

#### 2.2.5 PluginStateManager（扩展）

**新增职责**：
- 持久化后台插件的运行状态
- 应用重启后恢复后台插件

**扩展数据结构**：
```typescript
interface PluginStateConfig {
  [pluginName: string]: {
    enabled: boolean
    installedAt?: number
    updatedAt?: number
    // 新增字段
    backgroundRunning?: boolean      // 是否在后台运行
    backgroundStartedAt?: number     // 后台启动时间
    backgroundRestartCount?: number  // 重启次数
  }
}
```

---

## 3. 配置和类型定义

### 3.1 Manifest 扩展

在 `pluginSetting` 中添加后台运行配置：

```typescript
interface PluginSetting {
  single?: boolean              // 是否单例模式运行（默认 true）
  height?: number               // 插件初始高度
  defaultDetached?: boolean     // 是否默认以独立窗口运行（默认 false）

  // 新增：后台运行配置
  background?: boolean          // 是否允许后台运行（默认 false）
  persistent?: boolean          // 是否持久化（重启后自动恢复，默认 false）
  maxRuntime?: number           // 最大运行时间（毫秒，0 表示无限制，默认 0）
}
```

**示例**：
```json
{
  "pluginSetting": {
    "background": true,
    "persistent": true,
    "maxRuntime": 3600000
  }
}
```

### 3.2 后台插件信息类型

```typescript
interface BackgroundPluginInfo {
  pluginId: string
  pluginName: string
  displayName: string
  startedAt: number              // 启动时间戳
  uptime: number                 // 运行时长（毫秒）
  persistent: boolean            // 是否持久化
  maxRuntime: number             // 最大运行时间

  // 资源使用情况（来自 Watchdog）
  memoryUsage: number            // 内存使用（MB）
  cpuUsage: number               // CPU 使用率（%）
  requestCount: number           // 请求计数
  errorCount: number             // 错误计数

  // 健康状态
  healthy: boolean               // 是否健康
  lastHeartbeat: number          // 最后心跳时间
  missedHeartbeats: number       // 丢失心跳次数
}
```

---

## 4. 生命周期管理

### 4.1 生命周期钩子扩展

在现有钩子基础上新增：

```typescript
interface PluginLifecycleHooks {
  onLoad?: () => void | Promise<void>       // 首次加载
  onUnload?: () => void | Promise<void>     // 卸载
  onEnable?: () => void | Promise<void>     // 启用
  onDisable?: () => void | Promise<void>    // 禁用

  // 新增：后台运行钩子
  onBackground?: () => void | Promise<void>    // 进入后台时
  onForeground?: () => void | Promise<void>    // 从后台恢复时
}
```

**调用时机**：
- `onBackground`：窗口关闭但插件继续后台运行时
- `onForeground`：后台插件的窗口重新打开时

### 4.2 生命周期流程

#### 4.2.1 启动后台插件

```
用户触发插件运行
    ↓
检查 pluginSetting.background
    ↓
创建/获取 Host 进程
    ↓
调用 onLoad（如果未初始化）
    ↓
执行插件逻辑
    ↓
窗口关闭
    ↓
调用 onBackground 钩子
    ↓
注册到 BackgroundPluginManager
    ↓
Host 进程保持运行
    ↓
Watchdog 持续监控
```

#### 4.2.2 停止后台插件

```
用户手动停止 / 超时 / 资源超限
    ↓
BackgroundPluginManager.stop()
    ↓
从后台列表移除
    ↓
HostManager.destroyHost()
    ↓
调用 onUnload 钩子
    ↓
终止 Host 进程
    ↓
Watchdog 注销监控
```

#### 4.2.3 持久化恢复

```
应用启动
    ↓
PluginStateManager 加载状态
    ↓
BackgroundPluginManager.restorePersistent()
    ↓
遍历 backgroundRunning=true 的插件
    ↓
检查 persistent=true
    ↓
创建 Host 进程
    ↓
调用 onLoad 钩子
    ↓
注册到 Watchdog
```

---

## 5. 资源管理

### 5.1 资源限制策略

#### 5.1.1 后台插件专用配置

```typescript
const BACKGROUND_WATCHDOG_CONFIG: WatchdogConfig = {
  heartbeatInterval: 5000,       // 5 秒（与现有一致）
  heartbeatTimeout: 10000,       // 10 秒（与现有一致）
  maxMissedHeartbeats: 3,        // 3 次（与现有一致）
  maxMemoryMB: 256,              // 256 MB（后台插件更严格）
  maxRequestsPerMinute: 500,     // 500 次/分钟（后台插件更严格）
  maxErrorsPerMinute: 30         // 30 次/分钟（后台插件更严格）
}
```

#### 5.1.2 运行时间限制

- 如果 `maxRuntime > 0`，启动定时器自动终止
- 如果 `maxRuntime = 0`，无限制运行（需谨慎）

```typescript
class BackgroundPluginManager {
  private startPlugin(pluginId: string, maxRuntime: number) {
    if (maxRuntime > 0) {
      const timer = setTimeout(() => {
        console.log(`[Background] Plugin ${pluginId} reached maxRuntime, stopping`)
        this.stop(pluginId)
      }, maxRuntime)

      this.runtimeTimers.set(pluginId, timer)
    }
  }
}
```

### 5.2 异常处理

#### 5.2.1 Watchdog 事件处理

```typescript
// 在 BackgroundPluginManager 中监听 Watchdog 事件
watchdog.on('host:unresponsive', (pluginId) => {
  console.warn(`[Background] Plugin ${pluginId} unresponsive, stopping`)
  this.stop(pluginId)
})

watchdog.on('host:memory-exceeded', (pluginId, memoryMB) => {
  console.warn(`[Background] Plugin ${pluginId} memory exceeded: ${memoryMB}MB, stopping`)
  this.stop(pluginId)
})

watchdog.on('host:error-threshold', (pluginId, errorCount) => {
  console.warn(`[Background] Plugin ${pluginId} error threshold: ${errorCount}, stopping`)
  this.stop(pluginId)
})
```

#### 5.2.2 崩溃恢复策略

**不自动重启**：
- 后台插件崩溃后不自动重启
- 记录崩溃日志到 loggerService
- 用户可以手动重启

**原因**：
- 避免崩溃循环消耗资源
- 让用户意识到插件存在问题
- 简化实现，减少复杂度

---

## 6. 持久化方案

### 6.1 状态存储

扩展 `plugin-state.json`：

```json
{
  "my-plugin": {
    "enabled": true,
    "installedAt": 1234567890,
    "backgroundRunning": true,
    "backgroundStartedAt": 1234567890,
    "backgroundRestartCount": 0
  }
}
```

### 6.2 恢复策略

**应用启动时**：
1. 读取 `plugin-state.json`
2. 筛选 `backgroundRunning=true` 且 `persistent=true` 的插件
3. 按顺序恢复后台插件（延迟启动，避免启动卡顿）
4. 恢复失败的插件标记为 `backgroundRunning=false`

**延迟启动**：
```typescript
async restorePersistent() {
  const plugins = this.getPluginsToRestore()

  // 延迟 2 秒启动，避免影响应用启动速度
  setTimeout(async () => {
    for (const plugin of plugins) {
      try {
        await this.start(plugin.id)
        console.log(`[Background] Restored plugin: ${plugin.id}`)
      } catch (err) {
        console.error(`[Background] Failed to restore plugin: ${plugin.id}`, err)
        this.stateManager.setBackgroundRunning(plugin.id, false)
      }
    }
  }, 2000)
}
```

### 6.3 应用退出时

**优雅退出**：
1. 遍历所有后台插件
2. 保存 `backgroundRunning` 状态
3. 调用 `onUnload` 钩子
4. 等待最多 3 秒
5. 强制终止所有 Host 进程

```typescript
async shutdown() {
  const plugins = this.list()

  // 保存状态
  for (const info of plugins) {
    this.stateManager.setBackgroundRunning(info.pluginId, true)
  }

  // 优雅退出
  await Promise.race([
    Promise.all(plugins.map(info => this.stop(info.pluginId))),
    new Promise(resolve => setTimeout(resolve, 3000))
  ])
}
```

---

## 7. IPC 接口设计

### 7.1 新增 IPC 通道

```typescript
// 列出所有后台插件
ipcMain.handle('plugin:listBackground', () => {
  return backgroundManager.list()
})

// 停止后台插件
ipcMain.handle('plugin:stopBackground', async (_, pluginId: string) => {
  await backgroundManager.stop(pluginId)
  return { success: true }
})

// 获取后台插件详细信息
ipcMain.handle('plugin:getBackgroundInfo', (_, pluginId: string) => {
  return backgroundManager.getInfo(pluginId)
})

// 手动启动后台插件（用于测试或手动恢复）
ipcMain.handle('plugin:startBackground', async (_, pluginId: string) => {
  const success = await backgroundManager.start(pluginId)
  return { success }
})
```

### 7.2 事件通知

```typescript
// 后台插件启动
webContents.send('background:started', { pluginId, pluginName })

// 后台插件停止
webContents.send('background:stopped', { pluginId, reason })

// 后台插件资源警告
webContents.send('background:warning', { pluginId, type, message })
```

---

## 8. 用户界面设计

### 8.1 系统托盘指示

**macOS/Windows/Linux**：
- 托盘图标显示后台插件数量徽章
- 右键菜单显示后台插件列表
- 点击插件名称可以打开管理界面

```typescript
// 更新托盘菜单
function updateTrayMenu() {
  const backgroundPlugins = backgroundManager.list()

  const menuItems = [
    {
      label: `后台插件 (${backgroundPlugins.length})`,
      enabled: false
    },
    { type: 'separator' },
    ...backgroundPlugins.map(info => ({
      label: `${info.displayName} - ${formatUptime(info.uptime)}`,
      submenu: [
        {
          label: '打开窗口',
          click: () => openPlugin(info.pluginId)
        },
        {
          label: '停止运行',
          click: () => backgroundManager.stop(info.pluginId)
        }
      ]
    })),
    { type: 'separator' },
    {
      label: '管理后台插件',
      click: () => openBackgroundManager()
    }
  ]

  tray.setContextMenu(Menu.buildFromTemplate(menuItems))
}
```

### 8.2 后台插件管理界面

**位置**：设置 → 插件管理 → 后台插件标签页

**功能**：
1. **列表展示**：
   - 插件名称、图标
   - 运行时长
   - 内存使用、CPU 使用
   - 健康状态指示器

2. **操作按钮**：
   - 停止运行
   - 打开窗口（如果有 UI）
   - 查看日志

3. **资源图表**：
   - 实时内存使用曲线
   - CPU 使用率曲线
   - 请求速率统计

4. **全局操作**：
   - 停止所有后台插件
   - 刷新列表

### 8.3 插件详情页扩展

在插件详情页添加：
- 后台运行开关（如果插件支持）
- 持久化开关
- 运行时间限制设置
- 当前后台运行状态

---

## 9. 安全性考虑

### 9.1 权限声明

**强制要求**：
- 插件必须在 `manifest.json` 中显式声明 `background: true`
- 未声明的插件无法后台运行

### 9.2 资源隔离

**复用现有机制**：
- UtilityProcess 进程隔离
- VM2 沙箱隔离
- API 白名单机制

### 9.3 审计日志

**记录关键事件**：
```typescript
// 后台插件启动
logger.info('background:start', { pluginId, timestamp })

// 后台插件停止
logger.info('background:stop', { pluginId, reason, timestamp })

// 资源超限
logger.warn('background:resource-exceeded', { pluginId, type, value })

// 崩溃
logger.error('background:crash', { pluginId, error, timestamp })
```

---

## 10. 性能优化

### 10.1 内存管理

**定期检查**：
- Watchdog 每 5 秒检查一次内存使用
- 超过限制立即终止

**内存泄漏检测**：
- 监控内存增长趋势
- 如果内存持续增长（每分钟 > 10MB），发出警告

### 10.2 启动优化

**延迟恢复**：
- 应用启动后延迟 2 秒再恢复后台插件
- 避免影响主窗口启动速度

**批量限制**：
- 同时最多恢复 3 个后台插件
- 其余插件排队等待

### 10.3 Electron 优化

**避免主进程阻塞**：
- 所有后台插件运行在 UtilityProcess 中
- 主进程只负责协调和监控

**减少 IPC 开销**：
- 批量更新资源使用数据（每 5 秒一次）
- 避免频繁的 IPC 通信

---

## 11. 实现计划

### 11.1 Phase 1 - 基础后台运行（MVP）

**目标**：实现基本的后台运行能力

**任务**：
1. 扩展 `PluginSetting` 类型定义
2. 实现 `BackgroundPluginManager` 类
3. 修改 `PluginManager` 支持后台运行
4. 修改 `HostManager` 支持长时间运行
5. 添加 IPC 接口
6. 简单的托盘菜单展示

**验收标准**：
- 插件可以在窗口关闭后继续运行
- 可以通过托盘菜单停止后台插件
- Watchdog 正常监控后台插件

### 11.2 Phase 2 - 持久化和恢复

**目标**：支持应用重启后恢复后台插件

**任务**：
1. 扩展 `PluginStateManager`
2. 实现持久化逻辑
3. 实现恢复逻辑
4. 添加延迟启动优化

**验收标准**：
- 应用重启后自动恢复后台插件
- 恢复失败的插件正确标记
- 不影响应用启动速度

### 11.3 Phase 3 - 管理界面和监控

**目标**：提供完善的管理和监控界面

**任务**：
1. 实现后台插件管理界面
2. 实时资源监控图表
3. 日志查看功能
4. 完善托盘菜单

**验收标准**：
- 用户可以直观地看到所有后台插件
- 实时显示资源使用情况
- 可以方便地停止和管理后台插件

### 11.4 Phase 4 - 高级特性

**目标**：优化和增强

**任务**：
1. 内存泄漏检测
2. 性能优化
3. 更细粒度的资源限制
4. 插件间通信（可选）

---

## 12. 测试计划

### 12.1 单元测试

- `BackgroundPluginManager` 的启动、停止、列表功能
- 持久化和恢复逻辑
- 资源限制触发

### 12.2 集成测试

- 后台插件与 HostManager 的集成
- Watchdog 监控后台插件
- IPC 接口调用

### 12.3 性能测试

- 10 个后台插件同时运行
- 长时间运行（24 小时）的内存稳定性
- 应用启动时间影响

### 12.4 用户测试

- 后台插件的启动和停止流程
- 管理界面的易用性
- 资源使用的合理性

---

## 13. 风险和限制

### 13.1 风险

1. **内存泄漏**：长时间运行可能导致内存泄漏
   - 缓解：严格的内存监控和限制

2. **资源滥用**：恶意插件可能滥用后台运行
   - 缓解：资源限制、Watchdog 监控、用户可见性

3. **电池消耗**：后台插件增加电池消耗
   - 缓解：提示用户、限制后台插件数量

4. **启动变慢**：恢复多个后台插件可能影响启动速度
   - 缓解：延迟启动、批量限制

### 13.2 限制

1. **不支持自动重启**：崩溃后不自动重启
2. **最大运行时间**：建议设置 `maxRuntime` 避免无限运行
3. **资源限制**：后台插件的资源限制比前台更严格
4. **平台差异**：某些平台可能有额外限制（如 macOS 的 App Nap）

---

## 14. 文档和示例

### 14.1 开发者文档

**插件开发指南**：
```markdown
## 后台运行

如果你的插件需要在窗口关闭后继续运行（如定时任务、监控），可以启用后台运行：

### 配置

在 `manifest.json` 中添加：

```json
{
  "pluginSetting": {
    "background": true,
    "persistent": true,
    "maxRuntime": 3600000
  }
}
```

### 生命周期钩子

```javascript
export default {
  onLoad() {
    // 插件首次加载时调用
    console.log('Plugin loaded')
  },

  onBackground() {
    // 进入后台时调用
    console.log('Plugin running in background')
  },

  onForeground() {
    // 从后台恢复时调用
    console.log('Plugin back to foreground')
  },

  onUnload() {
    // 插件卸载时调用（清理资源）
    console.log('Plugin unloaded')
  }
}
```

### 注意事项

1. 后台插件的资源限制更严格（内存 256MB，请求 500次/分钟）
2. 避免在后台执行 CPU 密集型操作
3. 定期清理不需要的数据，避免内存泄漏
4. 使用 `maxRuntime` 限制运行时间
```

### 14.2 示例插件

**定时提醒插件**：
```javascript
// manifest.json
{
  "name": "reminder",
  "displayName": "定时提醒",
  "pluginSetting": {
    "background": true,
    "persistent": true
  }
}

// main.js
let timers = []

export default {
  onLoad({ api }) {
    // 从存储中恢复定时器
    const reminders = api.storage.get('reminders') || []
    reminders.forEach(reminder => {
      scheduleReminder(reminder, api)
    })
  },

  onUnload() {
    // 清理所有定时器
    timers.forEach(timer => clearTimeout(timer))
    timers = []
  },

  run({ api, input }) {
    // 添加新的提醒
    const reminder = parseInput(input)
    scheduleReminder(reminder, api)

    // 保存到存储
    const reminders = api.storage.get('reminders') || []
    reminders.push(reminder)
    api.storage.set('reminders', reminders)
  }
}

function scheduleReminder(reminder, api) {
  const delay = reminder.time - Date.now()
  if (delay > 0) {
    const timer = setTimeout(() => {
      api.notification.show(reminder.message)
    }, delay)
    timers.push(timer)
  }
}
```

---

## 15. 总结

本设计方案在现有架构基础上，通过新增 `BackgroundPluginManager` 模块，复用 `Watchdog`、`HostManager`、`PluginStateManager` 等现有组件，实现了插件后台运行功能。

**核心优势**：
- ✅ 与现有架构深度集成，代码复用率高
- ✅ 严格的资源管理和监控，防止滥用
- ✅ 用户可见、可控，透明度高
- ✅ 支持持久化，应用重启后自动恢复
- ✅ 性能优化，不影响主应用体验

**实现复杂度**：中等
- Phase 1（MVP）：约 3-5 天
- Phase 2（持久化）：约 2-3 天
- Phase 3（管理界面）：约 3-4 天
- Phase 4（高级特性）：约 2-3 天

**总计**：约 10-15 天完成完整功能。
