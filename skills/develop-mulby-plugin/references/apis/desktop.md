# Desktop API (desktop)

> 入口：`window.mulby.desktop`
> 代码来源：`src/preload/index.ts`、`src/main/ipc/desktop.ts`

## 方法

### searchFiles(query, limit?)
搜索系统文件。

- `query`: 关键词
- `limit`（可选）: 返回数量上限

### searchApps(query, limit?)
搜索系统应用（跨平台 provider）。

- `query`: 关键词
- `limit`（可选）: 返回数量上限

## 示例

```ts
const files = await window.mulby.desktop.searchFiles('report', 20)
const apps = await window.mulby.desktop.searchApps('code', 10)
```
