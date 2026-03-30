# Mulby 原生能力增强与数据隔离改进方案

> 版本：v1.0 | 创建时间：2026-03-30
> 对标项目：ZTools (MIT License)
> 目标：修补 Mulby 在底层原生能力和数据安全方面的关键短板

---

## 目录

1. [P0 — 插件文件系统沙箱化](#p0--插件文件系统沙箱化)
2. [P1-A — macOS 窗口监听原生化](#p1-a--macos-窗口监听原生化)
3. [P1-B — 屏幕截图/取色器原生化](#p1-b--屏幕截图取色器原生化)
4. [P1-C — 插件 KV 存储引擎升级](#p1-c--插件-kv-存储引擎升级)
5. [P2-A — 全局鼠标钩子](#p2-a--全局鼠标钩子)
6. [P2-B — 双击修饰键唤醒](#p2-b--双击修饰键唤醒)
7. [P3-A — 数据同步 (WebDAV)](#p3-a--数据同步-webdav)

---

## P0 — 插件数据隔离与文件系统分级保护 ✅ 已完成

### 问题

`PluginFilesystem` 是 `fs` 模块的直接透传，没有任何访问控制。
但**不能简单地加白名单沙箱**——这会导致文件处理类插件（图片批处理、PDF 工具、文件重命名等）无法正常工作。

真正的问题是两个层面：
1. **插件之间的数据没有隔离** — 插件 A 可以读写插件 B 的私有存储
2. **缺少高危操作的安全防护** — 没有防止误操作删除系统文件的保护

### 设计理念：信任用户意图，保护系统安全

> Mulby 是效率工具，插件处理用户文件是**核心场景**，不应被沙箱限制。
> 我们应该保护的是：(1) 插件之间的数据边界，(2) 操作系统关键路径。

参考 macOS 自身的安全模型：**用户通过 dialog 选择的路径 = 用户意图表达 = 信任**。

### 涉及文件

- `src/main/plugin/filesystem.ts` — 已重构
- `src/main/plugin/api.ts` — 已修改
- `src/main/ipc/filesystem.ts` — 已修改
- `src/main/plugin/__tests__/filesystem-protection.test.ts` — 新增

### 设计方案

#### 核心思路：三级分区

```
┌─────────────────────────────────────────────────────────────┐
│                     文件系统访问分级                           │
├──────────────┬──────────────────────────────────────────────┤
│ 🟢 自由区域   │ 用户通过 dialog / 搜索栏传入 / 拖放的路径      │
│              │ → 完全信任，不做任何限制                        │
│              │ 场景：批处理图片覆盖原图、保存到任意目录           │
├──────────────┼──────────────────────────────────────────────┤
│ 🟡 隔离区域   │ 插件私有数据 ({userData}/plugin-data/{name}/)  │
│              │ → 强制隔离，插件 A 不能访问插件 B 的数据         │
│              │ 场景：storage.get/set 对应的底层文件             │
├──────────────┼──────────────────────────────────────────────┤
│ 🔴 禁止区域   │ 系统关键路径黑名单                              │
│              │ → 硬性阻断，无论如何都不允许                     │
│              │ 例如：/System, /usr, /bin, C:\Windows 等       │
└──────────────┴──────────────────────────────────────────────┘
```

#### 1. 系统路径黑名单（仅防止灾难性误操作）

**不是白名单（限制能去哪），而是黑名单（禁止碰哪些）**：

```typescript
// 绝对禁止写入/删除的系统关键路径
const SYSTEM_PROTECTED_PATHS = process.platform === 'darwin'
  ? ['/System', '/usr', '/bin', '/sbin', '/Library/System', '/private/var/db']
  : ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']

// 仅阻断写入和删除操作，读取不限制
function checkSystemProtection(targetPath: string, operation: 'write' | 'delete'): void {
  const resolved = path.resolve(targetPath)
  const isProtected = SYSTEM_PROTECTED_PATHS.some(p => 
    resolved.toLowerCase().startsWith(p.toLowerCase())
  )
  if (isProtected) {
    throw new PluginSecurityError(
      `操作被阻止：不允许对系统路径 "${resolved}" 执行 ${operation} 操作`
    )
  }
}
```

#### 2. 插件私有数据隔离

每个插件有独立的数据目录，互相不可见：

```typescript
class PluginFilesystem {
  private pluginName: string
  private pluginDataRoot: string  // {userData}/plugin-data/{pluginName}/

  constructor(pluginName: string) {
    this.pluginName = pluginName
    this.pluginDataRoot = join(app.getPath('userData'), 'plugin-data', pluginName)
    mkdirSync(this.pluginDataRoot, { recursive: true })
  }

  // 插件专属数据目录（自动隔离）
  getDataPath(...subPaths: string[]): string {
    return join(this.pluginDataRoot, ...subPaths)
  }

  // 原有的通用文件操作 — 依然可以操作任何用户路径
  readFile(filePath: string, encoding?: 'utf-8' | 'base64'): string | Buffer {
    return readFileSync(filePath, ...) // 读取不限制
  }

  writeFile(filePath: string, data: string | Buffer): void {
    checkSystemProtection(filePath, 'write')       // 仅阻止写入系统路径
    writeFileSync(filePath, data)
  }

  unlink(filePath: string): void {
    checkSystemProtection(filePath, 'delete')       // 仅阻止删除系统路径
    checkPluginDataBoundary(filePath, this.pluginName) // 防止删除其他插件数据
    unlinkSync(filePath)
  }
}
```

#### 3. 跨插件数据访问防护

防止插件 A 通过路径拼接访问插件 B 的私有数据：

```typescript
function checkPluginDataBoundary(filePath: string, currentPlugin: string): void {
  const resolved = path.resolve(filePath)
  const pluginDataBase = join(app.getPath('userData'), 'plugin-data')
  
  // 如果路径指向 plugin-data 目录
  if (resolved.startsWith(pluginDataBase)) {
    const relative = path.relative(pluginDataBase, resolved)
    const targetPlugin = relative.split(path.sep)[0]
    
    // 只允许访问自己的子目录
    if (targetPlugin !== currentPlugin) {
      throw new PluginSecurityError(
        `插件 "${currentPlugin}" 尝试访问插件 "${targetPlugin}" 的私有数据`
      )
    }
  }
}
```

#### 4. 审计日志

不阻断操作，但记录插件的文件系统活动，便于排查问题：

```typescript
function auditLog(pluginName: string, operation: string, filePath: string): void {
  if (!auditEnabled) return
  const entry = `[${new Date().toISOString()}] [${pluginName}] ${operation}: ${filePath}`
  appendFileSync(auditLogPath, entry + '\n')
}
```

### 为什么不用严格白名单？

| 场景 | 严格白名单下的体验 | 分级保护下的体验 |
|------|-------------------|----------------|
| 批量处理 ~/Photos 下的图片 | ❌ 被拦截，需要逐个目录授权 | ✅ 正常工作 |
| 覆盖原图保存 | ❌ 需要额外授权流程 | ✅ 正常工作 |
| 保存到 ~/Desktop | ❌ 需要 manifest 声明 | ✅ 正常工作 |
| 删除 /System/Library 文件 | ✅ 被拦截 | ✅ 被拦截（黑名单） |
| 插件 A 读取插件 B 数据 | ✅ 被拦截 | ✅ 被拦截（隔离） |

### 任务步骤

- [x] **T0.1** 重构 `PluginFilesystem` 为有状态类（接收 `pluginName`）
- [x] **T0.2** 实现 `checkSystemProtection()` 系统路径黑名单
- [x] **T0.3** 实现 `checkPluginDataBoundary()` 跨插件数据访问防护（读/写/删除全覆盖）
- [x] **T0.4** 为每个插件创建独立数据目录 `{userData}/plugin-data/{pluginName}/`
- [x] **T0.5** 新增 `getDataPath()` API，让插件方便访问自己的私有目录
- [x] **T0.6** 在 `createPluginAPI()` 中为每个插件创建独立的 `PluginFilesystem` 实例
- [x] **T0.7** 实现审计日志模块，记录文件操作
- [x] **T0.8** 编写单元测试：系统路径阻断、跨插件隔离、路径穿越防护、大小写绕过防护、根目录保护

### 实施结果

> 完成时间：2026-03-30

#### 改动文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main/plugin/filesystem.ts` | 重构 | 有状态类 + 三级保护 + 审计日志 |
| `src/main/plugin/api.ts` | 修改 | 每插件独立实例 + `getDataPath` API |
| `src/main/ipc/filesystem.ts` | 修改 | 复用系统路径黑名单保护 |
| `src/main/plugin/__tests__/filesystem-protection.test.ts` | 新增 | 217 tests all pass |
| `scripts/run-unit-tests.mjs` | 修改 | 注册新测试目录 |

#### 代码审查修复（Codex Review）

实施后经过 Codex 代码审查，发现并修复了 3 个 P1 安全漏洞：

1. **读操作未做隔离检查** — `readFile/exists/readdir/stat` 可以读取其他插件私有数据
   → 新增 `checkRead()` 方法，读操作也执行跨插件边界检查
2. **大小写不敏感 FS 绕过** — macOS/Windows 上通过大小写变体绕过 `startsWith()`
   → 新增 `normalizePath()` 统一转小写后再比较
3. **plugin-data 根目录未保护** — `relative()` 返回空字符串时未阻断，可通过 `move()` 重命名整个根目录
   → 空 `targetPlugin` 直接抛出 `PluginSecurityError`

---

## P1-A — macOS 窗口监听原生化

### 问题

macOS 端通过 `execFile('osascript', ...)` 子进程获取活跃窗口信息：
- 每次调用 50-200ms 延迟
- 500ms 缓存导致感知延迟
- 不支持事件驱动的持续监听

### 涉及文件

- `src/main/services/active-window.ts` — 需要重构
- `native/clipboard-watcher.mm` — 需要扩展

### ZTools 参考

> **参考路径**: `ZTools/src/main/core/native/index.ts` L188-236

ZTools 使用 C++ 原生模块（`WindowMonitor` 类），通过以下系统 API 实现事件驱动的窗口监听：
- macOS: `NSWorkspaceDidActivateApplicationNotification`（工作空间通知）
- Windows: `SetWinEventHook` + `EVENT_SYSTEM_FOREGROUND`

回调结构包含 `app`, `bundleId`, `pid`, `title`, `x`, `y`, `width`, `height`, `appPath`

### 设计方案

#### 方案 A：扩展现有 C++ 原生模块（推荐）

在现有 `native/clipboard-watcher.mm` 基础上新增 `WindowWatcher` 类：

```objc
// native/window-watcher.mm

@interface WindowWatcher : NSObject
- (void)startWithCallback:(napi_threadsafe_function)tsfn;
- (void)stop;
@end

@implementation WindowWatcher {
  napi_threadsafe_function _tsfn;
}

- (void)startWithCallback:(napi_threadsafe_function)tsfn {
  _tsfn = tsfn;
  
  [[[NSWorkspace sharedWorkspace] notificationCenter]
    addObserver:self
    selector:@selector(onAppActivated:)
    name:NSWorkspaceDidActivateApplicationNotification
    object:nil];
}

- (void)onAppActivated:(NSNotification *)notification {
  NSRunningApplication *app = notification.userInfo[NSWorkspaceApplicationKey];
  // 提取 app.localizedName, app.bundleIdentifier, app.processIdentifier
  // 通过 tsfn 回调到 JS 层
}
@end
```

### 任务步骤

- [x] **T1A.1** 在 `native/` 下新增 `window-watcher.mm`（macOS）和 `window-watcher.cpp`（Windows）
- [x] **T1A.2** 更新 `binding.gyp`，新增 `WindowWatcher` 的编译目标
- [x] **T1A.3** 创建 `src/main/services/native-window-watcher.ts`，封装 N-API 绑定
- [x] **T1A.4** 重构 `active-window.ts`：
  - macOS: 优先使用原生 `WindowWatcher`（利用 `AXObserver` 和 `NSWorkspace` 实现同应用内精确窗口捕捉），失败回退到 osascript 轮询
  - Windows: 保持现有 Koffi FFI 方案（性能已满足）
  - 新增 `onActiveWindowChange(callback)` 事件 API 并过滤掉 Mulby 自身的进程
- [x] **T1A.5** 将主窗口显示时的 `refreshActiveWindowCache()` 改为订阅 `onActiveWindowChange` 事件
- [x] **T1A.6** 为插件 API 暴露 `system.onActiveWindowChange()` 事件接口
- [x] **T1A.7** CI/CD 配置：确保 native 模块在 macOS arm64/x64 和 Windows x64 上正确编译打包

---

## P1-B — 屏幕截图/取色器原生化 ✅ 已完成

### 问题（已解决）

原方案的核心缺陷：
1. ~~**截图需要"先隐藏覆盖窗口 → 等 100ms → 再截"**，延迟明显~~ → 已消除
2. ~~**取色器每 70ms 通过 IPC 获取一帧**，仅 ~14fps~~ → 已提升到 60fps+
3. ~~`CaptureWindow` 使用 `contextIsolation: false` + 临时 HTML 文件，存在安全风险~~ → 已删除
4. ~~`desktopCapturer.getSources()` 返回的缩略图在 HiDPI 下精度不足~~ → 已用原生模块替代

### 实现架构

```
┌───────────────────────────────────────────────────────────────┐
│  插件 API (screen.capture / screen.captureRegion / colorPick) │
├───────────────────────────────────────────────────────────────┤
│  screen.ts / region-capture.ts / color-pick.ts — 统一入口      │
├──────────┬────────────────────┬────────────────────────────────┤
│          │   原生模块优先      │   desktopCapturer fallback     │
│          ├────────────────────┤                                │
│          │ native-screen-      │                                │
│          │ capture.ts          │                                │
│          │ (TS 封装 + HiDPI    │                                │
│          │  坐标转换)          │                                │
│          ├────────────────────┤                                │
│          │ screen_capture.node │                                │
│          │ (C++ N-API)         │                                │
├──────────┼────────────────────┼────────────────────────────────┤
│  macOS   │ CGWindowListCreate  │ Electron desktopCapturer      │
│          │ Image               │                                │
│          │ + NSColorSampler    │                                │
├──────────┼────────────────────┤                                │
│  Windows │ GDI+ BitBlt        │                                │
│          │ + GetPixel          │                                │
├──────────┼────────────────────┤                                │
│  Linux   │ X11 XGetImage      │                                │
│          │ + XGetPixel         │                                │
└──────────┴────────────────────┴────────────────────────────────┘
```

### 涉及文件

| 类型 | 文件 | 说明 |
|------|------|------|
| 🆕 新增 | `native/screen-capture.mm` | macOS 原生截图模块（CGWindowListCreateImage + NSColorSampler） |
| 🆕 新增 | `native/screen-capture.cpp` | Windows GDI+ / Linux X11 原生截图模块 |
| 🆕 新增 | `src/main/services/native-screen-capture.ts` | 原生模块 TS 封装（加载/转换/裁剪/HiDPI 坐标转换） |
| ✏️ 重构 | `src/main/plugin/screen.ts` | 移除 CaptureWindow，原生模块优先 + desktopCapturer fallback |
| ✏️ 重构 | `src/main/plugin/region-capture.ts` | macOS screencapture -i / Win+Linux 逐屏预截取方案 |
| ✏️ 重构 | `src/main/plugin/color-pick.ts` | NSColorSampler / 逐屏预截取三层回退方案 |
| ✏️ 修改 | `src/main/plugin/manager.ts` | preCapture 前隐藏主窗口，防止搜索框被截入 |
| ✏️ 修改 | `src/main/plugin/window.ts` | 新增 hideMainWindowForCapture/showMainWindowAfterCapture |
| ✏️ 修改 | `src/main/openclaw/handlers/canvas-handler.ts` | 迁移到 pluginScreen |
| ✏️ 修改 | `native/binding.gyp` | 添加 screen_capture 编译目标 |
| ✏️ 修改 | `src/preload/apis/region-capture.ts` | 新增 onSnapshot 回调 |
| ✏️ 修改 | `src/preload/apis/color-pick.ts` | 新增 onSnapshot 回调 |
| 🗑️ 删除 | `src/main/plugin/capture-window.ts` | 已删除（消除 contextIsolation:false 安全风险） |

### 性能提升

| 功能 | 旧方案 | 新方案 | 提升 |
|------|--------|--------|------|
| **全屏截图** | CaptureWindow + getUserMedia (~200ms) | CGWindowListCreateImage / GDI+ BitBlt (< 20ms) | **10x** |
| **区域截图** | 隐藏窗口 → 等 100ms → desktopCapturer | macOS: screencapture -i (零延迟) / Win+Linux: 预截取+覆盖窗口 | **消除延迟** |
| **取色器预览** | IPC → desktopCapturer (70ms/帧 ≈ 14fps) | macOS: NSColorSampler / Win+Linux: 内存 bitmap 读取 (< 1ms) | **14fps → 60fps+** |

### 跨平台方案详解

#### macOS
- **全屏截图**: `CGWindowListCreateImage` — 直接内存截图，零磁盘 I/O
- **区域截图**: `screencapture -i -r` — 系统原生选区 UI，支持窗口截图、空格切换
- **取色器**: `NSColorSampler` — macOS 10.15+ 系统原生取色面板（带放大镜）

#### Windows
- **全屏/区域截图**: GDI+ `BitBlt` → BGRA bitmap → nativeImage，自动 DIP→设备像素转换
- **取色器**: `GetPixel` 点取色 + 预截取覆盖窗口放大镜（内存 canvas 读取，零 IPC）

#### Linux
- **全屏/区域截图**: X11 `XGetImage` → BGRA bitmap → nativeImage
- **取色器**: 同 Windows 预截取方案（覆盖窗口 + 本地 canvas 读取）

#### 回退策略
所有平台：原生模块加载失败时自动回退到 Electron `desktopCapturer.getSources()`

### 取色器三层回退策略（completeColorPick）

```
用户点击取色
    ↓
策略 1: nativeGetPixelColor(x, y)        ← 原生模块可用时（最快，< 1ms）
    ↓ 失败
策略 2: displaySnapshots[displayId].raw   ← raw BGRA bitmap 直接读索引（无解码）
    ↓ 失败
策略 3: displaySnapshots[displayId].dataUrl → nativeImage 解析 → toBitmap() 读像素
    ↓ 失败
返回 null（所有策略均失败）
```

### Codex Review 修复记录

| 等级 | 问题 | 修复 |
|------|------|------|
| **P1** | `completeColorPick` 在原生模块不可用时无法取色 | 添加三层回退策略 |
| **P1** | 多显示器只截取 display 0 的快照，复用给所有覆盖窗口 | 改为逐屏独立截取 `Map<displayId, snapshot>` |
| **P1** | Windows HiDPI 下 GDI 收到 DIP 坐标但需要设备像素坐标 | TS 层添加 `dipToDevice()` 坐标转换 |
| **P2** | 多显示器取色器背景错误 | 同上逐屏快照方案 |
| **P2** | macOS 取色 fallback 用 `screencapture -i` 截区域取中心像素不可靠 | 移除，NSColorSampler null 即返回 |

### preCapture 主窗口隐藏

从搜索结果列表触发 preCapture 截图时，必须先隐藏主搜索框窗口，否则截图中会包含搜索框：

```
用户点击搜索结果 → hideMainWindowForCapture() → 等待窗口消失(200ms) → 截图
  ├─ 截图成功 → 打开插件窗口（主窗口保持隐藏）
  ├─ 用户取消 → showMainWindowAfterCapture() 恢复搜索框
  └─ 截图失败 → showMainWindowAfterCapture() 恢复 + 回退旧流程
```

> **注意**：此隐藏仅影响 preCapture 路径。插件通过 `mulby.screen.capture()` 直接调用的截图不受影响。

### 已完成任务

- [x] **T1B.1** 创建 `native/screen-capture.mm` — macOS CGWindowListCreateImage + NSColorSampler
- [x] **T1B.2** 创建 `native/screen-capture.cpp` — Windows GDI+ / Linux X11
- [x] **T1B.3** 更新 `native/binding.gyp` 添加 screen_capture 编译目标
- [x] **T1B.4** 创建 `src/main/services/native-screen-capture.ts` TS 封装层（含 HiDPI 转换）
- [x] **T1B.5** 重构 `screen.ts` — 移除 CaptureWindow，原生模块优先 + fallback
- [x] **T1B.6** 重构 `region-capture.ts` — macOS screencapture / Win+Linux 逐屏预截取
- [x] **T1B.7** 重构 `color-pick.ts` — NSColorSampler / 逐屏预截取三层回退
- [x] **T1B.8** 更新 preload 文件适配新方案（region-capture.ts / color-pick.ts）
- [x] **T1B.9** 迁移 canvas-handler.ts 的 desktopCapturer 调用到 pluginScreen
- [x] **T1B.10** 删除 `capture-window.ts`（消除 contextIsolation:false 安全风险）
- [x] **T1B.11** Codex Review 5 项修复（多显示器、HiDPI、fallback）
- [x] **T1B.12** preCapture 截图前隐藏主搜索框窗口
- [x] **T1B.13** TypeScript 编译验证 ✅ / 原生模块编译验证 ✅

---

## P1-C — 插件 KV 存储引擎升级

### 问题

`PluginStorage` 使用 JSON 文件存储，每次 `get/set` 都需要全量读写文件：
- 100 个 key 的插件需要反序列化整个 JSON
- 高频写入场景（如剪贴板监听插件）会造成明显卡顿
- 没有批量操作和事务支持

### 涉及文件

- `src/main/plugin/storage.ts` — 需要重构
- `src/main/db/index.ts` — 可以复用现有 SQLite
- `src/main/plugin/api.ts` L260-266 — storage API 绑定

### ZTools 参考

> **参考路径**: `ZTools/src/main/core/lmdb/index.ts` L1-226
> **参考路径**: `ZTools/src/main/core/lmdb/syncApi.ts`

ZTools 使用 LMDB，但引入 LMDB 作为新依赖可能带来打包和原生编译问题。
我们**复用已有的 better-sqlite3**，它已经在项目中了。

### 设计方案

将 `PluginStorage` 从 JSON 文件改为 SQLite，复用 `src/main/db/index.ts` 中的 `store` 表。
该表已经有 `(plugin_id, key)` 复合主键，结构天然适合插件隔离存储。

```typescript
// 新的 PluginStorage 实现
import db from '../db'

const getStmt = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')
const setStmt = db.prepare(`
  INSERT INTO store (plugin_id, key, value, updated_at) 
  VALUES (?, ?, ?, ?) 
  ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)
const removeStmt = db.prepare('DELETE FROM store WHERE plugin_id = ? AND key = ?')
const clearStmt = db.prepare('DELETE FROM store WHERE plugin_id = ?')
const keysStmt = db.prepare('SELECT key FROM store WHERE plugin_id = ?')

export class PluginStorage {
  get(pluginName: string, key: string): unknown {
    const row = getStmt.get(pluginName, key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }

  set(pluginName: string, key: string, value: unknown): void {
    setStmt.run(pluginName, key, JSON.stringify(value), Date.now())
  }

  remove(pluginName: string, key: string): void {
    removeStmt.run(pluginName, key)
  }

  clear(pluginName: string): void {
    clearStmt.run(pluginName)
  }

  keys(pluginName: string): string[] {
    return (keysStmt.all(pluginName) as { key: string }[]).map(r => r.key)
  }
}
```

### 任务步骤

- [ ] **T1C.1** 重写 `PluginStorage`：基于 SQLite prepared statement 实现
- [ ] **T1C.2** 数据迁移脚本：将 `plugin-data/*.json` 的数据迁移到 SQLite `store` 表
- [ ] **T1C.3** 添加 `has()` 和 `getAll()` 方法，扩展 API 能力
- [ ] **T1C.4** 添加 `bulkSet()` 批量写入方法（使用 SQLite 事务）
- [ ] **T1C.5** 更新插件 API 暴露的 `storage.*` 接口
- [ ] **T1C.6** 保留 JSON 文件作为 fallback，首次启动时自动迁移
- [ ] **T1C.7** 删除旧的 JSON 文件存储逻辑（迁移完成后）

---

## P2-A — 全局鼠标钩子

### 问题

`uiohook-napi` 已在项目依赖中，但 `KeyboardHookService` 仅使用了 `keydown` 事件，
鼠标事件（`mousedown`, `mouseup`, `mousemove`, `click`）完全未被利用。

### 涉及文件

- `src/main/services/keyboard-hook.ts` — 可扩展为 `input-hook.ts`

### ZTools 参考

> **参考路径**: `ZTools/src/main/core/native/index.ts` L432-503 (MouseMonitor)
> **参考路径**: `ZTools/src/main/core/superPanelManager.ts` L148-164

ZTools 的 `MouseMonitor` 使用 C++ 原生模块实现了鼠标按钮类型 + 长按阈值 + 事件拦截的组合能力。
但对于 Mulby，我们可以先用 `uiohook-napi` 的 JS 层实现基础鼠标监听，
后续再考虑 C++ 原生方案。

### 设计方案

将 `KeyboardHookService` 扩展为 `InputHookService`，同时支持键盘和鼠标事件：

```typescript
import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi'

// 鼠标按钮映射
type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward'

interface MouseBinding {
  button: MouseButton
  action: 'click' | 'longpress'
  longPressMs?: number  // 长按阈值
  callback: (event: { x: number; y: number }) => void
}

export class InputHookService {
  private keyBindings = new Map<string, HookBinding>()
  private mouseBindings = new Map<string, MouseBinding>()
  private mouseDownTimers = new Map<number, NodeJS.Timeout>()

  // 注册鼠标钩子
  registerMouse(
    id: string,
    button: MouseButton,
    action: 'click' | 'longpress',
    callback: (event: { x: number; y: number }) => void,
    longPressMs?: number
  ): boolean {
    this.mouseBindings.set(id, { button, action, longPressMs, callback })
    this.ensureStarted()
    return true
  }

  private onMouseDown = (event: UiohookMouseEvent) => {
    // 长按检测：设置定时器，到期后触发
    for (const [id, binding] of this.mouseBindings) {
      if (binding.action === 'longpress' && matchButton(event.button, binding.button)) {
        const timer = setTimeout(() => {
          binding.callback({ x: event.x, y: event.y })
          this.mouseDownTimers.delete(event.button)
        }, binding.longPressMs || 500)
        this.mouseDownTimers.set(event.button, timer)
      }
    }
  }

  private onMouseUp = (event: UiohookMouseEvent) => {
    // 清除长按定时器
    const timer = this.mouseDownTimers.get(event.button)
    if (timer) {
      clearTimeout(timer)
      this.mouseDownTimers.delete(event.button)
    }
    // 点击检测
    for (const [id, binding] of this.mouseBindings) {
      if (binding.action === 'click' && matchButton(event.button, binding.button)) {
        binding.callback({ x: event.x, y: event.y })
      }
    }
  }
}
```

### 任务步骤

- [ ] **T2A.1** 将 `keyboard-hook.ts` 重命名/重构为 `input-hook.ts`
- [ ] **T2A.2** 新增 `registerMouse()` / `unregisterMouse()` 方法
- [ ] **T2A.3** 实现长按检测逻辑（定时器 + mouseUp 清除）
- [ ] **T2A.4** 注册 `uIOhook.on('mousedown')` 和 `uIOhook.on('mouseup')` 事件
- [ ] **T2A.5** 在 `app-shortcuts.ts` 中集成：添加鼠标中键唤醒选项
- [ ] **T2A.6** 更新设置界面，新增鼠标触发配置项

---

## P2-B — 双击修饰键唤醒

### 问题

用户无法通过双击 Command/Ctrl/Alt/Shift 键来快速唤出 Mulby。
这是 uTools/ZTools/Alfred 等效率工具的标配功能。

### ZTools 参考

> **参考路径**: `ZTools/src/main/core/doubleTapManager.ts` L1-172

ZTools 的 `DoubleTapManager` 实现非常精炼（仅 172 行），核心逻辑：
1. 监听 `keydown` 和 `keyup` 事件
2. 判断当前按键是否为修饰键（Command/Ctrl/Alt/Shift）
3. 过滤长按（超过 `MAX_TAP_DURATION=300ms` 的按键不算 tap）
4. 过滤组合键（期间有非修饰键按下则重置）
5. 检测两次 keyup 间隔 < `DOUBLE_TAP_INTERVAL=400ms` 则触发回调

### 设计方案

**直接移植** ZTools 的 `DoubleTapManager`，它:
- 依赖 `uiohook-napi`（已在项目中）
- 独立无其他依赖
- 实现完善，边界处理到位

需要调整的点：
- 集成到 Mulby 的 `app-shortcuts.ts` 快捷键管理模块
- 与现有的 `globalShortcut.register()` 和 `KeyboardHookService` 协调，避免 `uIOhook` 多次 `start()`/`stop()` 冲突

### 任务步骤

- [ ] **T2B.1** 创建 `src/main/services/double-tap.ts`，移植 ZTools `doubleTapManager.ts` 的逻辑
- [ ] **T2B.2** 解决 `uIOhook` 单例问题：统一由 `InputHookService` 管理 start/stop
- [ ] **T2B.3** 在设置界面中新增"双击修饰键唤醒"选项（默认关闭），可选择具体的修饰键
- [ ] **T2B.4** 在 `app-shortcuts.ts` 中集成 `DoubleTapManager`
- [ ] **T2B.5** 测试跨平台兼容：macOS (Command/Option), Windows (Ctrl/Alt)

---

## P3-A — 数据同步 (WebDAV)

### 问题

Mulby 完全没有数据同步能力。用户在多台设备上使用时：
- 应用设置需要手动配置
- 剪贴板历史无法跨设备
- 插件数据各自独立

### ZTools 参考

> **参考路径**: `ZTools/src/main/core/sync/syncEngine.ts` (34089 bytes，核心)
> **参考路径**: `ZTools/src/main/core/sync/webdavClient.ts` (WebDAV CRUD)
> **参考路径**: `ZTools/src/main/core/sync/pluginSyncWatcher.ts` (插件变更监听)
> **参考路径**: `ZTools/src/main/core/sync/pluginHasher.ts` (目录哈希)
> **参考路径**: `ZTools/src/main/core/sync/types.ts` (类型定义)

### 设计方案

#### 架构总览

```
┌─────────────────────────────────────────┐
│             SyncManager                  │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Settings │  │ Clipboard│  │ Plugin │ │
│  │ Syncer   │  │ Syncer   │  │ Syncer │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       └──────────────┼────────────┘      │
│                      ▼                    │
│             ┌─────────────┐              │
│             │ WebDAV      │              │
│             │ Client      │              │
│             └──────┬──────┘              │
└────────────────────┼─────────────────────┘
                     ▼
         ┌────────────────────┐
         │   WebDAV Server    │
         │ (Nextcloud/坚果云) │
         └────────────────────┘
```

#### 核心模块

1. **WebDAV Client** — 使用 `webdav` npm 包（ZTools 也用它）
2. **SyncEngine** — 冲突检测 + 增量同步 + 队列
3. **PluginSyncWatcher** — chokidar 监听插件目录变更
4. **SyncConfig** — 存储在 app-settings 中

#### 同步策略

- **设置同步**：全量替换，最后修改时间戳优胜
- **剪贴板历史**：仅同步收藏项（starred），最近限 200 条
- **插件数据**：基于目录哈希增量同步，使用 zip 压缩传输
- **冲突解决**：时间戳新者赢 + 保留冲突备份

### 任务步骤

> 这是最大的功能模块，建议拆分为多个迭代：

#### 迭代 1：基础 WebDAV 连接 + 设置同步

- [ ] **T3A.1** 安装 `webdav` 依赖
- [ ] **T3A.2** 创建 `src/main/services/sync/webdav-client.ts`，封装 WebDAV CRUD 操作
- [ ] **T3A.3** 创建 `src/main/services/sync/types.ts`，定义同步相关类型
- [ ] **T3A.4** 创建 `src/main/services/sync/sync-engine.ts`，实现基础同步循环
- [ ] **T3A.5** 实现设置同步：`app-settings.json` 双向同步
- [ ] **T3A.6** 设置界面集成：WebDAV 服务器 URL/用户名/密码配置，连接测试按钮

#### 迭代 2：插件数据同步

- [ ] **T3A.7** 创建 `plugin-sync-watcher.ts`，监听插件数据变更
- [ ] **T3A.8** 创建 `plugin-hasher.ts`，计算插件目录哈希
- [ ] **T3A.9** 实现插件数据增量同步逻辑

#### 迭代 3：剪贴板历史同步（可选）

- [ ] **T3A.10** 实现剪贴板收藏项同步

---

## 项目工作排期建议

| 阶段 | 模块 | 预计工作量 | 依赖 |
|------|------|-----------|------|
| Sprint 1 | ~~P0 文件系统分级保护~~ | ~~2-3 天~~ | ✅ 已完成 |
| Sprint 1 | P1-C 存储引擎升级 | 1-2 天 | 无 |
| Sprint 2 | P2-B 双击修饰键 | 1 天 | 无 |
| Sprint 2 | P2-A 鼠标钩子 | 1-2 天 | 无 |
| Sprint 3 | P1-A macOS 窗口监听 | 3-5 天 | C++ 编译环境 |
| Sprint 3 | P1-B 屏幕工具优化 | 2-3 天 | 部分依赖 P1-A |
| Sprint 4 | P3-A WebDAV 同步 | 5-7 天 | P1-C 完成 |

---

## 附录：ZTools 关键代码索引

| 功能 | 文件路径 | 行数 | 用途 |
|------|---------|------|------|
| 原生模块总入口 | `ZTools/src/main/core/native/index.ts` | 692 | ClipboardMonitor, WindowMonitor, MouseMonitor, ScreenCapture, ColorPicker |
| 双击修饰键检测 | `ZTools/src/main/core/doubleTapManager.ts` | 172 | 基于 uiohook-napi 的双击检测 |
| 超级面板 | `ZTools/src/main/core/superPanelManager.ts` | 860 | 鼠标触发 + 剪贴板识别 + 搜索联动 |
| 屏幕截图 | `ZTools/src/main/core/screenCapture.ts` | 88 | macOS: screencapture 命令, Windows: C++ 原生 |
| LMDB 数据库 | `ZTools/src/main/core/lmdb/index.ts` | 226 | 主数据库类，三库分离 |
| LMDB 同步 API | `ZTools/src/main/core/lmdb/syncApi.ts` | 400+ | 含命名空间隔离逻辑 |
| WebDAV 同步引擎 | `ZTools/src/main/core/sync/syncEngine.ts` | 900+ | 完整同步流程 |
| WebDAV 客户端 | `ZTools/src/main/core/sync/webdavClient.ts` | 280+ | WebDAV CRUD 封装 |
| 插件同步监听 | `ZTools/src/main/core/sync/pluginSyncWatcher.ts` | 100+ | chokidar + 脏标记 |
| 同步类型定义 | `ZTools/src/main/core/sync/types.ts` | 92 | SyncConfig, SyncResult 等 |
