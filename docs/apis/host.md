# 插件 Host API (host)
本文档描述 插件 Host API (host) 的使用方法与接口。

> 入口：`window.intools.host`

Host API 允许插件 UI 调用插件后端（UtilityProcess/Host）中的方法。

### host.invoke(pluginName, method, ...args)
[Renderer]
调用插件后端方法。

```javascript
const result = await window.intools.host.invoke('translator', 'storage.get', 'lastText');
```

**参数**:
- `pluginName` (string) - 插件 ID
- `method` (string) - 方法名，格式 `namespace.method`，如 `clipboard.readText`
- `...args` - 传给目标方法的参数

**返回值**: 目标方法的返回值

### host.status(pluginName)
[Renderer]
获取 Host 状态。

```javascript
const status = await window.intools.host.status('translator');
// { ready: boolean, active: boolean }
```

### host.restart(pluginName)
[Renderer]
重启插件 Host 进程。

```javascript
const ok = await window.intools.host.restart('translator');
```

**返回值**: `boolean` - 是否重启成功

### 完整示例

```javascript
const ready = await window.intools.host.status('translator');
if (ready.ready) {
  await window.intools.host.invoke('translator', 'storage.get', 'lastText');
}
```