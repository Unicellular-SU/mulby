## 15. Power API (power)

Power API 提供电源和系统状态监控，支持 macOS、Windows 和 Linux。

### 15.1 getSystemIdleTime()
获取系统空闲时间。

```javascript
const idleSeconds = await power.getSystemIdleTime();
console.log(`系统已空闲 ${idleSeconds} 秒`);
```

**返回值**: `number` - 空闲时间（秒）

### 15.2 getSystemIdleState(idleThreshold)
获取系统空闲状态。

```javascript
const state = await power.getSystemIdleState(60);
// 返回: 'active' | 'idle' | 'locked' | 'unknown'
```

**参数**:
- `idleThreshold` (number) - 空闲阈值（秒）

**返回值**: `string` - 空闲状态

### 15.3 isOnBatteryPower()
检查是否使用电池供电。

```javascript
if (await power.isOnBatteryPower()) {
  console.log('当前使用电池供电');
}
```

**返回值**: `boolean`

### 15.4 getCurrentThermalState()
获取当前热状态（仅 macOS）。

```javascript
const thermal = await power.getCurrentThermalState();
// macOS 返回: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'
// Windows/Linux 返回: 'unknown'
```

**返回值**: `string`

### 15.5 事件监听

```javascript
// 系统休眠
window.intools.power.onSuspend(() => {
  console.log('系统即将休眠');
});

// 系统唤醒
window.intools.power.onResume(() => {
  console.log('系统已唤醒');
});

// 切换到交流电
window.intools.power.onAC(() => {
  console.log('已连接电源');
});

// 切换到电池
window.intools.power.onBattery(() => {
  console.log('已切换到电池供电');
});

// 屏幕锁定
window.intools.power.onLockScreen(() => {
  console.log('屏幕已锁定');
});

// 屏幕解锁
window.intools.power.onUnlockScreen(() => {
  console.log('屏幕已解锁');
});
```
