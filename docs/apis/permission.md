# 权限 API (permission)
本文档描述 权限 API (permission) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.permission`
> - 插件后端：`context.api.permission`

权限 API 封装系统权限检测与跳转设置页，优先在 macOS 上提供真实状态。

插件访问 `screen` / `camera` / `microphone` / `geolocation` / `accessibility` / `contacts` / `calendar` 权限 API 时，必须先在 `manifest.json` 中声明对应权限：

```json
{
  "permissions": {
    "screen": true,
    "microphone": true,
    "camera": true,
    "geolocation": true,
    "accessibility": true
  }
}
```

未声明对应权限时，宿主会抛出 `Plugin "<pluginId>" lacks manifest.permissions.<permission>`；声明存在但系统拒绝时，状态会体现为 `denied`。`permission.*('notifications')` 对应 manifest 中的 `permissions.notification`。

### getStatus(type)
[Renderer] [Backend]
获取权限状态。

```javascript
const status = await permission.getStatus('accessibility');
```

**参数**:
- `type` - 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'

**返回值**: `PermissionStatus`

```typescript
type PermissionStatus =
  | 'authorized'
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'limited'
  | 'unknown'
```

### request(type)
[Renderer] [Backend]
请求权限。

```javascript
const status = await permission.request('camera');
```

**返回值**: `PermissionStatus`

### canRequest(type)
[Renderer] [Backend]
是否可程序化请求权限（未决定状态）。

```javascript
const can = await permission.canRequest('microphone');
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### openSystemSettings(type)
[Renderer] [Backend]
打开系统设置中的权限页面。

```javascript
await permission.openSystemSettings('accessibility');
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 当前平台不支持时返回 false

### isAccessibilityTrusted()
[Renderer] [Backend]
检查 macOS 辅助功能权限是否已授权。

```javascript
const trusted = await permission.isAccessibilityTrusted();
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### 完整示例

```javascript
const status = await window.mulby.permission.getStatus('camera');
if (status === 'not-determined') {
  await window.mulby.permission.request('camera');
}
```
