# Geolocation API (geolocation)
本文档描述 Geolocation API (geolocation) 的使用方法与接口。

> 入口：`window.mulby.geolocation`

Geolocation API 提供地理位置功能，支持 macOS、Windows 和 Linux。定位链路优先使用系统原生能力，无法获取精确位置时再降级到 Electron Web Geolocation，最后才使用 IP 后备定位。该 API 不依赖外部 API key。

插件必须在 `manifest.json` 中声明定位权限：

```json
{
  "permissions": {
    "geolocation": true
  }
}
```

未声明时宿主会拦截调用并抛出 `Plugin "<pluginId>" lacks manifest.permissions.geolocation`。

## 定位来源
- macOS：优先使用 CoreLocation，然后降级到 Electron Web Geolocation，再降级到 IP 定位。
- Windows：优先使用 Windows Location Service，然后降级到 Electron Web Geolocation，再降级到 IP 定位。
- Linux：优先使用 GeoClue2，然后降级到 Electron Web Geolocation，再降级到 IP 定位。

桌面端精度取决于系统位置服务、硬件、Wi-Fi/蓝牙/网络环境和系统授权状态。`accuracy` 是宿主返回的估计半径，单位为米。

### getAccessStatus()
[Renderer]
获取位置权限状态。

```javascript
const status = await geolocation.getAccessStatus()
// 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
```

**跨平台说明**：
- macOS：读取系统定位授权状态；未真实请求过时可能返回 `not-determined`。
- Windows/Linux：宿主无法只靠状态查询可靠判断系统级定位授权，通常返回 `not-determined`，实际可用性以 `getCurrentPosition()` 的 `attempts` 诊断为准。

**返回值**：`Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>`

### requestAccess()
[Renderer]
请求位置权限。

```javascript
const status = await geolocation.requestAccess()
if (status === 'granted') {
  // 可以继续获取位置
}
```

**跨平台说明**：
- macOS：调用系统权限请求流程，不执行定位探测。dev 模式或未签名应用可能仍返回 `not-determined`；实际定位失败原因会在 `getCurrentPosition()` 的 `attempts` 中体现。
- Windows/Linux：返回当前可判断状态；系统级授权通常在实际定位调用时由系统服务决定。

**返回值**：`Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>`

### canGetPosition()
[Renderer]
检查当前位置流程是否可继续执行。该方法只用于提前阻断明确的拒绝或受限状态；即使返回 `true`，原生定位仍可能失败并在 `getCurrentPosition()` 中降级。

```javascript
if (await geolocation.canGetPosition()) {
  const pos = await geolocation.getCurrentPosition()
}
```

**返回值**：`Promise<boolean>`

### openSettings()
[Renderer]
打开系统位置权限设置。

```javascript
await geolocation.openSettings()
```

**跨平台说明**：
- macOS：打开系统定位服务隐私设置。
- Windows：打开系统位置隐私设置。
- Linux：暂不支持统一系统设置入口。

**返回值**：`Promise<void>`

### getCurrentPosition(options)
[Renderer]
获取当前位置。

```javascript
const pos = await geolocation.getCurrentPosition({
  desiredAccuracy: 'best',
  allowFallback: true,
  timeoutMs: 10000
})

console.log(pos.latitude, pos.longitude, pos.provider, pos.fallbackUsed)
console.log(pos.attempts)
```

**参数**：

```typescript
interface GeolocationOptions {
  desiredAccuracy?: 'best' | 'balanced' | 'coarse'
  allowFallback?: boolean
  timeoutMs?: number
}
```

- `desiredAccuracy`：期望精度，默认 `best`。当前主要用于表达调用意图，具体精度由系统服务决定。
- `allowFallback`：是否允许降级到 IP 定位，默认 `true`。设置为 `false` 时，IP 后备不会被调用，适合“精确定位可用性测试”。
- `timeoutMs`：单个定位 provider 的超时时间，默认使用宿主内置超时，最小 1000ms。

**返回值**：`Promise<GeolocationPosition>`

```typescript
type GeolocationSource = 'native' | 'web' | 'ip'

type GeolocationProvider =
  | 'macos-corelocation'
  | 'windows-location-service'
  | 'linux-geoclue'
  | 'electron-web'
  | 'ip'
  | 'freegeoip.app'
  | 'ip-api.com'
  | 'ipwho.is'

interface GeolocationAttempt {
  provider: GeolocationProvider
  source: GeolocationSource
  status: 'success' | 'skipped' | 'error'
  accuracy?: number
  message?: string
}

interface GeolocationPosition {
  latitude: number
  longitude: number
  accuracy: number
  source: GeolocationSource
  provider: GeolocationProvider
  altitude?: number | null
  altitudeAccuracy?: number | null
  heading?: number | null
  speed?: number | null
  timestamp: number
  fallbackUsed: boolean
  attempts: GeolocationAttempt[]
}
```

字段说明：
- `source`：本次最终结果来源。`native` 表示系统原生定位，`web` 表示 Electron Web Geolocation，`ip` 表示 IP 后备定位。
- `provider`：本次最终成功的 provider 名称。IP 后备成功时会返回具体服务名，例如 `freegeoip.app`、`ip-api.com` 或 `ipwho.is`，而不是固定返回 `ip`。
- `fallbackUsed`：是否在成功前发生过 provider 失败或跳过。为 `true` 时应查看 `attempts`。
- `attempts`：按调用顺序记录每个 provider 的结果，便于展示清晰 fallback 原因。

### 完整示例

```javascript
async function getLocation() {
  const status = await geolocation.getAccessStatus()

  if (status === 'denied' || status === 'restricted') {
    await geolocation.openSettings()
    return null
  }

  if (status === 'not-determined') {
    const newStatus = await geolocation.requestAccess()
    if (newStatus === 'denied' || newStatus === 'restricted') {
      return null
    }
  }

  try {
    const position = await geolocation.getCurrentPosition({
      desiredAccuracy: 'best',
      allowFallback: true,
      timeoutMs: 10000
    })

    if (position.fallbackUsed) {
      console.warn('定位已降级:', position.attempts)
    }

    return position
  } catch (error) {
    console.error('获取位置失败:', error)
    return null
  }
}
```

### 精确定位测试

如果只想确认系统原生或 Electron Web Geolocation 是否可用，不希望降级到 IP：

```javascript
try {
  const position = await geolocation.getCurrentPosition({
    desiredAccuracy: 'best',
    allowFallback: false,
    timeoutMs: 10000
  })

  console.log(`精确定位可用: ${position.provider}, accuracy=${position.accuracy}m`)
} catch (error) {
  console.error('精确定位不可用:', error)
}
```
