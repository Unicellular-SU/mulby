# Plugin Store API (`pluginStore`)

> 入口: `window.mulby.pluginStore`
> 代码来源: `src/preload/index.ts`, `src/main/ipc/plugin.ts`, `src/main/plugin/store-service.ts`

## Methods

### `fetch()`
拉取插件商店索引，并返回插件列表、来源状态和当前安装状态。

补充说明:
- 远程仓库源默认要求 `HTTPS`
- `http://localhost` / `http://127.0.0.1` 这类本地开发源允许使用 HTTP
- 索引中的插件元数据支持 `publisher` / `homepage` / `repository` / `sha256`

### `installFromUrl(input)`
从下载地址安装或更新插件。

支持的输入字段:
- `pluginId`
- `version`
- `downloadUrl`
- `sourceId`
- `sourceName`
- `sourceUrl`
- `publisher`
- `homepage`
- `repository`
- `sha256`

返回补充字段:
- `integrityStatus`: `verified` | `missing`
- `integrityDigest`: 下载包的实际 SHA256

行为说明:
- 远程下载默认要求 `HTTPS`
- 如果提供 `sha256`，安装前会先校验下载包摘要
- 成功安装后会在插件目录写入 `.mulby-install.json`，记录来源元数据

### `checkUpdatesInstalled()`
检查当前已安装插件是否存在可用更新。

返回的更新项会附带来源信息和可选的 `sha256` 元数据，供更新时继续校验。

### `updateAll(pluginIds?)`
批量更新插件。可选地传入插件 ID 列表，只更新指定插件。

## Example

```ts
const { entries, sources } = await window.mulby.pluginStore.fetch()

const result = await window.mulby.pluginStore.installFromUrl({
  pluginId: 'hello-clipboard',
  version: '1.0.0',
  downloadUrl: 'https://example.com/hello-clipboard-1.0.0.inplugin',
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
})

if (result.integrityStatus === 'verified') {
  console.log('SHA256 verified:', result.integrityDigest)
}
```
