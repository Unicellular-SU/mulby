# Network API (network)
本文档描述 Network API (network) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.network`
> - 插件后端：`context.api.network`

Network API 提供网络状态监控，支持 macOS、Windows 和 Linux。

### isOnline()
[Renderer] [Backend]
检查当前是否在线。

```javascript
if (await network.isOnline()) {
  console.log('网络已连接');
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### onOnline(callback)
[Renderer]
监听网络恢复事件。

```javascript
window.mulby.network.onOnline(() => {
  console.log('网络已恢复');
});
```

### onOffline(callback)
[Renderer]
监听网络断开事件。

```javascript
window.mulby.network.onOffline(() => {
  console.log('网络已断开');
});
```

### 完整示例

```javascript
const online = await window.mulby.network.isOnline();
console.log('online:', online);
window.mulby.network.onOnline(() => console.log('网络恢复'));
```