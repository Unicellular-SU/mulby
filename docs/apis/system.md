## 11. System API (system)

System API 提供系统和应用信息，支持 macOS、Windows 和 Linux。

### 11.1 getSystemInfo()
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

### 11.2 getAppInfo()
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

### 11.3 getPath(name)
获取系统特定路径。

```javascript
const desktop = await system.getPath('desktop');
const downloads = await system.getPath('downloads');
const exePath = await system.getPath('exe');  // 可执行文件路径
```

**参数**:
- `name` - 路径名称：'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'

**返回值**: `string`

### 11.4 getEnv(name)
获取环境变量。

```javascript
const path = await system.getEnv('PATH');
const home = await system.getEnv('HOME');
```

**参数**:
- `name` (string) - 环境变量名

**返回值**: `string | undefined`

### 11.5 getIdleTime()
获取系统空闲时间。

```javascript
const idleSeconds = await system.getIdleTime();
if (idleSeconds > 300) {
  console.log('用户已离开超过5分钟');
}
```

**返回值**: `number` - 空闲时间（秒）

### 11.6 getFileIcon(filePath)
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

**返回值**: `string` - base64 Data URL 格式的图标

### 11.7 getNativeId()
获取设备唯一标识。

```javascript
const deviceId = await system.getNativeId();
// 用于存储设备相关数据
storage.set(`${deviceId}/settings`, { ... });
```


**返回值**: `string` - 32位设备唯一标识

### 11.8 isDev()
判断是否为开发环境。

```javascript
if (await system.isDev()) {
  console.log('当前为开发模式');
}
```

**返回值**: `boolean`

### 11.9 isMacOS() / isWindows() / isLinux()
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

**返回值**: `boolean`
