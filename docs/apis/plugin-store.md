# Plugin Store API (pluginStore)

> 入口：`window.mulby.pluginStore`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/plugin.ts`、`src/main/plugin/store-service.ts`

## 方法

### fetch()
拉取插件商店索引并返回安装状态。

### installFromUrl(input)
从下载地址安装/更新插件。

### checkUpdatesInstalled()
检查已安装插件是否有更新。

### updateAll(pluginIds?)
批量更新（可指定插件 ID）。

## 示例

```ts
const { entries } = await window.mulby.pluginStore.fetch()
const updates = await window.mulby.pluginStore.checkUpdatesInstalled()
```
