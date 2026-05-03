# Power API (power)
本文档描述 Power API (power) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.power`
> - 插件后端：`context.api.power`

Power API 提供电源和系统状态监控，支持 macOS、Windows 和 Linux。

### getSystemIdleTime()
[Renderer] [Backend]
获取系统空闲时间。

```javascript
const idleSeconds = await power.getSystemIdleTime();
console.log(`系统已空闲 ${idleSeconds} 秒`);
```

**返回值**: `number`（插件后端返回 `Promise<number>`） - 空闲时间（秒）

### getSystemIdleState(idleThreshold)
[Renderer] [Backend]
获取系统空闲状态。

```javascript
const state = await power.getSystemIdleState(60);
// 返回: 'active' | 'idle' | 'locked' | 'unknown'
```

**参数**:
- `idleThreshold` (number) - 空闲阈值（秒）

**返回值**: `string`（插件后端返回 `Promise<string>`） - 空闲状态

### isOnBatteryPower()
[Renderer] [Backend]
检查是否使用电池供电。

```javascript
if (await power.isOnBatteryPower()) {
  console.log('当前使用电池供电');
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### getCurrentThermalState()
[Renderer] [Backend]
获取当前热状态（仅 macOS）。

```javascript
const thermal = await power.getCurrentThermalState();
// macOS 返回: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'
// Windows/Linux 返回: 'unknown'
```

**返回值**: `string`（插件后端返回 `Promise<string>`）

### onSuspend(callback)
[Renderer]
系统即将休眠事件。

### onResume(callback)
[Renderer]
系统唤醒事件。

### onAC(callback)
[Renderer]
切换到交流电事件。

### onBattery(callback)
[Renderer]
切换到电池供电事件。

### onLockScreen(callback)
[Renderer]
屏幕锁定事件。

### onUnlockScreen(callback)
[Renderer]
屏幕解锁事件。

### 完整示例

```javascript
// 系统休眠
window.mulby.power.onSuspend(() => {
  console.log('系统即将休眠');
});

// 系统唤醒
window.mulby.power.onResume(() => {
  console.log('系统已唤醒');
});

// 切换到交流电
window.mulby.power.onAC(() => {
  console.log('已连接电源');
});

// 切换到电池
window.mulby.power.onBattery(() => {
  console.log('已切换到电池供电');
});

// 屏幕锁定
window.mulby.power.onLockScreen(() => {
  console.log('屏幕已锁定');
});

// 屏幕解锁
window.mulby.power.onUnlockScreen(() => {
  console.log('屏幕已解锁');
});
```