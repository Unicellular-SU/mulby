## 17. Network API (network)

Network API 提供网络状态监控，支持 macOS、Windows 和 Linux。

### 17.1 isOnline()
检查当前是否在线。

```javascript
if (await network.isOnline()) {
  console.log('网络已连接');
}
```

**返回值**: `boolean`

### 17.2 onOnline(callback)
监听网络恢复事件。

```javascript
window.intools.network.onOnline(() => {
  console.log('网络已恢复');
});
```

### 17.3 onOffline(callback)
监听网络断开事件。

```javascript
window.intools.network.onOffline(() => {
  console.log('网络已断开');
});
```
