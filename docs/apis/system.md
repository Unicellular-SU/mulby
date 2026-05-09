# System API (system)
本文档描述 System API (system) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.system`
> - 插件后端：`context.api.system`

System API 提供系统和应用信息，支持 macOS、Windows 和 Linux。

### getSystemInfo()
[Renderer] [Backend]
获取系统信息。

```javascript
const info = await system.getSystemInfo();
console.log(`平台: ${info.platform}`);
console.log(`CPU 核心数: ${info.cpus}`);
console.log(`总内存: ${(info.totalmem / 1024 / 1024 / 1024).toFixed(2)} GB`);
```

**返回值**: `SystemInfo`

```typescript
interface SystemInfo {
  platform: string;    // 'darwin' | 'win32' | 'linux'
  arch: string;        // 'x64' | 'arm64' 等
  hostname: string;    // 主机名
  username: string;    // 当前用户名
  homedir: string;     // 用户主目录
  tmpdir: string;      // 临时目录
  cpus: number;        // CPU 核心数
  totalmem: number;    // 总内存（字节）
  freemem: number;     // 可用内存（字节）
  uptime: number;      // 系统运行时间（秒）
  osVersion: string;   // 操作系统版本
  osRelease: string;   // 操作系统发行版本
}
```

### getAppInfo()
[Renderer] [Backend]
获取应用信息。

```javascript
const app = await system.getAppInfo();
console.log(`应用版本: ${app.version}`);
```

**返回值**: `AppInfo`

```typescript
interface AppInfo {
  name: string;        // 应用名称
  version: string;     // 应用版本
  locale: string;      // 系统语言
  isPackaged: boolean; // 是否为打包版本
  userDataPath: string; // 用户数据目录
}
```

### getAppResourceUsage()
[Renderer]
获取 Mulby 应用自身的资源占用快照。CPU 与内存来自 Electron 进程指标；磁盘占用仅统计用户数据目录，避免全盘扫描。

```javascript
const usage = await system.getAppResourceUsage();
console.log(usage.cpuPercent, usage.memoryBytes, usage.disk.userDataBytes);
```

**返回值**: `AppResourceUsage`

```typescript
interface AppResourceProcessUsage {
  pid: number
  type: string
  name?: string
  cpuPercent: number
  workingSetBytes: number
}

interface AppResourceDiskUsage {
  userDataPath: string
  userDataBytes: number
  fileCount: number
  directoryCount: number
  truncated: boolean
  scannedAt: number
}

interface AppResourceUsage {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  disk: AppResourceDiskUsage
  processes: AppResourceProcessUsage[]
}
```

### getPath(name)
[Renderer] [Backend]
获取系统特定路径。

```javascript
const desktop = await system.getPath('desktop');
const downloads = await system.getPath('downloads');
const exePath = await system.getPath('exe');  // 可执行文件路径
```

**参数**:
- `name` - 路径名称：'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'

**返回值**: `string`（插件后端返回 `Promise<string>`）

### getEnv(name)
[Renderer] [Backend]
获取环境变量。

```javascript
const path = await system.getEnv('PATH');
const home = await system.getEnv('HOME');
```

**参数**:
- `name` (string) - 环境变量名

**返回值**: `string | undefined`

### getIdleTime()
[Renderer] [Backend]
获取系统空闲时间。

```javascript
const idleSeconds = await system.getIdleTime();
if (idleSeconds > 300) {
  console.log('用户已离开超过5分钟');
}
```

**返回值**: `number`（插件后端返回 `Promise<number>`） - 空闲时间（秒）

### getFileIcon(filePath)
[Renderer]
获取文件/文件夹的系统图标。

```javascript
// 获取指定文件的图标
const icon = await system.getFileIcon('/path/to/file.pdf');
document.querySelector('img').src = icon;

// 获取扩展名类型的图标
const txtIcon = await system.getFileIcon('.txt');

// 获取文件夹图标
const folderIcon = await system.getFileIcon('folder');
```

**参数**:
- `filePath` (string) - 文件路径、扩展名（如 `.txt`）或 `'folder'`

**返回值**: `string`（插件后端返回 `Promise<string>`） - base64 Data URL 格式的图标

### getFileIcons(requests, options?)
[Renderer]
Batch get file/app icons for high-throughput list rendering.

```javascript
const icons = await system.getFileIcons(
  [
    { key: 'readme', path: '/path/to/README.md', kind: 'file' },
    { key: 'vscode', path: '/Applications/Visual Studio Code.app', kind: 'app' }
  ],
  { size: 128, concurrency: 6 }
);
// returns: [{ key, path, kind, icon }]
```

### getNativeId()
[Renderer]
获取设备唯一标识。

```javascript
const deviceId = await system.getNativeId();
// 用于存储设备相关数据
storage.set(`${deviceId}/settings`, { ... });
```


**返回值**: `string`（插件后端返回 `Promise<string>`） - 32位设备唯一标识

### isDev()
[Renderer]
判断是否为开发环境。

```javascript
if (await system.isDev()) {
  console.log('当前为开发模式');
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### isMacOS() / isWindows() / isLinux()
[Renderer]
判断当前操作系统平台。

```javascript
if (await system.isMacOS()) {
  // macOS 特定逻辑
} else if (await system.isWindows()) {
  // Windows 特定逻辑
} else if (await system.isLinux()) {
  // Linux 特定逻辑
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### onActiveWindowChange(callback)
[Backend]
监听系统前台活跃窗口变化。当用户切换前台应用时触发回调。

```javascript
const unsubscribe = system.onActiveWindowChange((info) => {
  console.log(`前台应用: ${info.app}, 标题: ${info.title}`);
});

// 取消监听
unsubscribe();
```

**参数**:
- `callback` (function) - 回调函数，参数为 `ActiveWindowInfo`

```typescript
interface ActiveWindowInfo {
  app: string;       // 应用名称 (如 "Safari", "Visual Studio Code")
  title: string;     // 窗口标题
  pid?: number;      // 进程 ID
  bundleId?: string; // macOS Bundle ID (如 "com.apple.Safari")
}
```

**返回值**: `() => void` - 取消监听函数

**插件 Worker 注意**：该方法的返回值是函数，无法通过 Worker 与主进程之间的 `postMessage` 结构化克隆传递。若在插件后端（`main.js` Worker）调用，可能导致 **「An object could not be cloned」** 或未处理的 Promise 拒绝。Worker 场景请改用下面的 `getCachedActiveWindow` / `getActiveWindow`。

### getCachedActiveWindow()
[Backend]
同步读取主进程已缓存的前台窗口信息（不阻塞；依赖主应用常驻的活跃窗口订阅维持缓存）。返回值仅为普通对象，可在插件 Worker 中安全使用。

```javascript
const info = await mulby.system.getCachedActiveWindow();
if (info) {
  console.log(info.app, info.title);
}
```

**返回值**: `Promise<ActiveWindowInfo | null>`

### getActiveWindow()
[Backend]
异步抓取当前前台窗口（必要时触发系统查询）。多数场景优先使用 `getCachedActiveWindow`。

```javascript
const info = await mulby.system.getActiveWindow();
```

**返回值**: `Promise<ActiveWindowInfo | null>`

### 完整示例

```javascript
const info = await window.mulby.system.getSystemInfo();
console.log(info.platform, info.arch);
```
