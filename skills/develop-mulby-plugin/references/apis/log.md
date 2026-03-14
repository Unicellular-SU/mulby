# Log API (log)

> 入口：`window.mulby.log`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/log.ts`

## 写入方法

- `debug(message, ...args)`
- `info(message, ...args)`
- `warn(message, ...args)`
- `error(message, ...args)`

## 查询与订阅

### getLogs(options?)
按插件、级别、数量查询日志。

### clear(pluginId?)
清理日志（可按插件）。

### getLogsDir()
返回日志目录。

### subscribe()
触发主进程开始推送实时日志。

### onLog(callback)
订阅 `log:new` 事件。

## 示例

```ts
await window.mulby.log.subscribe()
const off = window.mulby.log.onLog((entry) => {
  console.log(entry.level, entry.message)
})
```
