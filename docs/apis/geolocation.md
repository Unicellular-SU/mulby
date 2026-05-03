# Geolocation API (geolocation)
本文档描述 Geolocation API (geolocation) 的使用方法与接口。

> 入口：`window.mulby.geolocation`

Geolocation API 提供地理位置功能，支持 macOS、Windows 和 Linux。

### getAccessStatus()
[Renderer]
获取位置权限状态。

```javascript
const status = await geolocation.getAccessStatus();
// 返回: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
```

**跨平台说明**:
- macOS: 使用 `node-mac-permissions` 获取实际权限状态
- Windows/Linux: 默认返回 'granted'

**返回值**: `string`（插件后端返回 `Promise<string>`）

### requestAccess()
[Renderer]
请求位置权限（仅 macOS 有效）。

```javascript
const status = await geolocation.requestAccess();
if (status === 'granted') {
  // 可以获取位置
}
```

**跨平台说明**:
- macOS: 尝试触发系统权限弹窗，如果权限已被拒绝，会打开系统设置
- Windows/Linux: 直接返回当前状态

**返回值**: `string`（插件后端返回 `Promise<string>`） - 权限状态

### canGetPosition()
[Renderer]
检查是否可以获取位置。

```javascript
if (await geolocation.canGetPosition()) {
  const pos = await geolocation.getCurrentPosition();
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### openSettings()
[Renderer]
打开系统位置权限设置。

```javascript
await geolocation.openSettings();
```

**跨平台说明**:
- macOS: 打开 系统偏好设置 > 安全性与隐私 > 定位服务
- Windows: 打开 设置 > 隐私 > 位置
- Linux: 暂不支持

### getCurrentPosition()
[Renderer]
获取当前位置。

```javascript
try {
  const pos = await geolocation.getCurrentPosition();
  console.log(`纬度: ${pos.latitude}, 经度: ${pos.longitude}`);
} catch (err) {
  console.error('获取位置失败:', err);
}
```

**返回值**: `GeolocationPosition`

```typescript
interface GeolocationPosition {
  latitude: number      // 纬度
  longitude: number     // 经度
  accuracy: number      // 精度（米）
  source: 'native' | 'ip' // 定位来源：原生或 IP 后备
  altitude?: number     // 海拔
  altitudeAccuracy?: number
  heading?: number      // 方向
  speed?: number        // 速度
  timestamp: number     // 时间戳
}
```

### 完整示例

```javascript
// 推荐的权限检查流程
async function getLocation() {
  // 1. 检查权限状态
  const status = await geolocation.getAccessStatus();
  
  // 2. 处理不同状态
  if (status === 'denied' || status === 'restricted') {
    await notification.show('请在系统设置中开启位置权限', 'error');
    await geolocation.openSettings();
    return null;
  }
  
  if (status === 'not-determined') {
    const newStatus = await geolocation.requestAccess();
    if (newStatus !== 'granted') {
      await notification.show('位置权限未授权', 'warning');
      return null;
    }
  }
  
  // 3. 获取位置
  try {
    return await geolocation.getCurrentPosition();
  } catch (error) {
    await notification.show('获取位置失败: ' + error.message, 'error');
    return null;
  }
}
```
