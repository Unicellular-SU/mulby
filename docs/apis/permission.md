## 18. 权限 API (permission)

权限 API 封装系统权限检测与跳转设置页，优先在 macOS 上提供真实状态。

### 18.1 getStatus(type)
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

### 18.2 request(type)
请求权限。

```javascript
const status = await permission.request('camera');
```

**返回值**: `PermissionStatus`

### 18.3 canRequest(type)
是否可程序化请求权限（未决定状态）。

```javascript
const can = await permission.canRequest('microphone');
```

**返回值**: `boolean`

### 18.4 openSystemSettings(type)
打开系统设置中的权限页面。

```javascript
await permission.openSystemSettings('accessibility');
```

**返回值**: `boolean` - 当前平台不支持时返回 false

### 18.5 isAccessibilityTrusted()
检查 macOS 辅助功能权限是否已授权。

```javascript
const trusted = await permission.isAccessibilityTrusted();
```

**返回值**: `boolean`
