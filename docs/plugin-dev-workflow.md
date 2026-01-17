# 打包后的插件开发调试方案

## 问题背景

当前开发流程中，插件位于项目根目录的 `plugins/` 下，开发时直接由 `PluginManager` 从 `process.cwd()/plugins` 加载。这在开发阶段非常便捷，但当应用打包发布后：

1. **开发目录不可用**：打包后 `process.cwd()` 不再是项目根目录，开发中的插件无法被加载
2. **用户数据目录隔离**：已安装插件位于 `~/Library/Application Support/intools/plugins/`（macOS），开发者需要将插件复制到这里才能测试
3. **调试体验下降**：每次修改都需要重新打包 `.inplugin` 文件并安装，效率极低

---

## 解决方案

### 核心思路

在应用设置中添加「开发者选项」，支持：
- 启用/禁用开发者模式
- 指定外部插件开发目录
- 自动热重载
- 开发者工具控制
- 日志级别设置

---

## 开发者模式配置

### 数据结构

在 `AppSettings` 中新增 `developer` 字段：

```typescript
// src/shared/types/settings.ts
export interface DeveloperSettings {
  enabled: boolean           // 是否启用开发者模式
  pluginPaths: string[]      // 外部插件开发目录列表
  autoReload: boolean        // 是否自动热重载（监听文件变化）
  showDevTools: boolean      // 是否自动打开 DevTools
  logLevel: 'debug' | 'info' | 'warn' | 'error'  // 日志级别
}

export interface AppSettings {
  shortcuts: AppShortcutSettings
  storeSources: StoreSource[]
  developer: DeveloperSettings  // 新增
}
```

### 默认值

```typescript
// src/main/services/app-settings.ts
const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: { ... },
  storeSources: [],
  developer: {
    enabled: false,
    pluginPaths: [],
    autoReload: true,
    showDevTools: false,
    logLevel: 'info'
  }
}
```

---

## 设置界面

### 开发者选项模块

在设置侧边栏添加「开发者」选项，界面如下：

```
┌─────────────────────────────────────────────────────────────────┐
│ 开发者选项                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 启用开发者模式                                        [  开关  ] │
│ 开启后可从外部目录加载开发中的插件                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 插件开发目录                                                     │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ /Users/su/workspace/my-plugins                       [移除] │ │
│ │ /Users/su/workspace/in_tools/plugins                 [移除] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [+ 添加目录]                            [刷新插件]               │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 自动热重载                                            [  开关  ] │
│ 检测文件变化时自动重新加载插件                                     │
│                                                                 │
│ 自动打开开发者工具                                     [  开关  ] │
│ 打开插件窗口时自动打开 DevTools                                   │
│                                                                 │
│ 日志级别                                                         │
│ [Debug] [Info] [Warn] [Error]                                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 📊 日志输出                                                      │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [12:00:01] [INFO] Plugin loaded: my-plugin                  │ │
│ │ [12:00:02] [DEBUG] Feature registered: my-plugin:main       │ │
│ │ [12:00:03] [INFO] Plugin UI attached                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ [清空日志]                              [导出日志]               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 插件加载逻辑修改

### PluginManager.init() 更新

```typescript
// src/main/plugin/manager.ts
async init() {
  this.plugins.clear()
  this.runners.clear()

  const settings = appSettingsManager.getSettings()
  const developer = settings.developer

  // 1. 用户数据目录的插件（已安装）
  const userPluginsDir = join(app.getPath('userData'), 'plugins')
  
  // 2. 开发目录的插件（仅开发模式下有效）
  const devPluginsDir = join(process.cwd(), 'plugins')
  
  // 3. 用户自定义的开发目录（开发者模式启用时生效）
  const customDevDirs = developer.enabled ? developer.pluginPaths : []

  const dirs = [
    userPluginsDir,
    ...(app.isPackaged ? [] : [devPluginsDir]),  // 打包后不从 cwd/plugins 加载
    ...customDevDirs.filter(d => existsSync(d))   // 自定义的开发目录
  ].filter(d => existsSync(d))

  // ... 后续加载逻辑不变
  
  // 标记开发目录的插件
  for (const plugin of this.plugins.values()) {
    plugin.isDev = customDevDirs.some(dir => plugin.path.startsWith(dir))
  }
}
```

---

## 日志系统

### 开发者日志服务

```typescript
// src/main/services/dev-logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: number
  level: LogLevel
  category: string  // 'plugin' | 'host' | 'ipc' | 'window'
  message: string
  data?: unknown
}

class DevLogger {
  private logs: LogEntry[] = []
  private maxLogs = 1000
  private level: LogLevel = 'info'
  private listeners: Set<(entry: LogEntry) => void> = new Set()

  setLevel(level: LogLevel) {
    this.level = level
  }

  debug(category: string, message: string, data?: unknown) {
    this.log('debug', category, message, data)
  }

  info(category: string, message: string, data?: unknown) {
    this.log('info', category, message, data)
  }

  warn(category: string, message: string, data?: unknown) {
    this.log('warn', category, message, data)
  }

  error(category: string, message: string, data?: unknown) {
    this.log('error', category, message, data)
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown) {
    if (!this.shouldLog(level)) return
    
    const entry: LogEntry = { timestamp: Date.now(), level, category, message, data }
    this.logs.push(entry)
    
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
    
    // 通知监听器（用于实时显示）
    this.listeners.forEach(listener => listener(entry))
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  clear() {
    this.logs = []
  }

  subscribe(listener: (entry: LogEntry) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const devLogger = new DevLogger()
```

### 在关键位置添加日志

```typescript
// 插件加载
devLogger.info('plugin', `Loaded: ${plugin.id}`, { path: plugin.path, version: plugin.manifest.version })

// 插件运行
devLogger.debug('plugin', `Running: ${name}:${featureCode}`, { input })

// Host 进程
devLogger.debug('host', `Created host for: ${plugin.id}`, { pid: host.pid })

// IPC 调用
devLogger.debug('ipc', `API call: ${apiName}`, { args })
```

---

## IPC 接口

### 新增接口

```typescript
// src/main/ipc/developer.ts
export function registerDeveloperHandlers(pluginManager: PluginManager) {
  // 添加开发目录
  ipcMain.handle('developer:addPluginPath', async (_event, path: string) => {
    const settings = appSettingsManager.getSettings()
    if (settings.developer.pluginPaths.includes(path)) {
      return { success: false, error: '目录已存在' }
    }
    if (!existsSync(path)) {
      return { success: false, error: '目录不存在' }
    }
    
    appSettingsManager.updateSettings({
      developer: {
        ...settings.developer,
        pluginPaths: [...settings.developer.pluginPaths, path]
      }
    })
    
    await pluginManager.init()  // 重新加载插件
    return { success: true }
  })

  // 移除开发目录
  ipcMain.handle('developer:removePluginPath', async (_event, path: string) => {
    const settings = appSettingsManager.getSettings()
    appSettingsManager.updateSettings({
      developer: {
        ...settings.developer,
        pluginPaths: settings.developer.pluginPaths.filter(p => p !== path)
      }
    })
    
    await pluginManager.init()
    return { success: true }
  })

  // 刷新插件
  ipcMain.handle('developer:reloadPlugins', async () => {
    await pluginManager.init()
    return { success: true }
  })

  // 获取日志
  ipcMain.handle('developer:getLogs', () => {
    return devLogger.getLogs()
  })

  // 清空日志
  ipcMain.handle('developer:clearLogs', () => {
    devLogger.clear()
    return { success: true }
  })

  // 选择目录对话框
  ipcMain.handle('developer:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择插件开发目录'
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
```

---

## 开发工作流

### 场景 1：本地开发新插件

```bash
# 1. 创建插件
cd ~/my-plugins
intools create my-awesome-plugin
cd my-awesome-plugin

# 2. 在 InTools 应用中启用开发者模式
# 设置 -> 开发者 -> 开启开发者模式 -> 添加目录 -> 选择 ~/my-plugins

# 3. 开发插件
npm run dev  # 启动 Vite 开发服务器

# 4. 在 InTools 中测试
# 输入关键词触发插件，修改代码后自动热重载
```

### 场景 2：调试已打包应用中的插件

```bash
# 1. 打包应用
npm run electron:build

# 2. 启动应用，启用开发者模式
# 设置 -> 开发者 -> 开启开发者模式

# 3. 添加插件开发目录
# 点击「添加目录」，选择插件所在文件夹

# 4. 修改插件代码，应用自动重载
```

### 场景 3：查看调试日志

```bash
# 1. 设置 -> 开发者 -> 日志级别 -> Debug
# 2. 触发插件执行
# 3. 在日志面板查看详细执行过程
# 4. 可导出日志文件用于问题排查
```

---

## 实现任务清单

### P0：必需功能

- [ ] 类型定义：在 `AppSettings` 中添加 `developer` 字段
- [ ] 服务层：更新 `AppSettingsManager` 默认值和合并逻辑
- [ ] 插件管理：`PluginManager.init()` 支持自定义开发目录
- [ ] IPC 接口：添加开发者相关接口（addPluginPath, removePluginPath, reloadPlugins）
- [ ] Preload：暴露开发者相关 API
- [ ] 设置界面：添加「开发者」section 和 UI 组件

### P1：增强功能

- [ ] 日志服务：实现 `DevLogger` 服务
- [ ] 日志界面：实时显示日志、清空、导出
- [ ] 文件监听：检测开发目录变化，自动刷新插件
- [ ] DevTools：根据设置自动打开开发者工具

### P2：可选优化

- [ ] 插件来源标识：在插件列表中显示「开发中」标记
- [ ] CLI 命令：`intools link` 自动注册当前目录到开发目录
- [ ] 热重载优化：仅重载变化的插件，而非全部重新加载

---

## 附录：当前插件加载逻辑

当前 `PluginManager.init()` 从两个目录加载插件：

```typescript
// src/main/plugin/manager.ts
const userPluginsDir = join(app.getPath('userData'), 'plugins')  // 用户数据目录
const devPluginsDir = join(process.cwd(), 'plugins')             // 开发目录（仅开发模式）
```

打包后 `process.cwd()` 变为应用安装目录，导致开发目录失效。解决方案就是允许用户手动指定开发目录。
