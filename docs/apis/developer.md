# Developer API (developer)

> 入口：`window.mulby.developer`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/developer.ts`

## 方法

### addPluginPath(path)
添加外部插件开发目录。

### removePluginPath(path)
移除外部插件开发目录。

### reloadPlugins()
重载插件列表。

### selectDirectory()
打开系统目录选择器并返回路径。

## 示例

```ts
const dir = await window.mulby.developer.selectDirectory()
if (dir) {
  await window.mulby.developer.addPluginPath(dir)
  await window.mulby.developer.reloadPlugins()
}
```
