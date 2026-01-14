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
```

**参数**:
- `name` - 路径名称：'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

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
