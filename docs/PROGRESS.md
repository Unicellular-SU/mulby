# 项目进展记录

## 2026-05-03 修复后端 API 文档异步签名
- 确认了 `host-worker.ts` 中 `createProxyAPI` 转发的所有 API 均返回 Promise。
- 修正了 `docs/apis/` 及 `skills/develop-mulby-plugin/references/apis/` 下多个文档中后端 API 被误标为“同步”的问题。
- **涉及文件：**
  - `storage.md`: 所有的 get, set, remove, clear, keys 增加了 `await` 并修改返回值为 `Promise`。
  - `features.md`: 所有的 getFeatures, setFeature, removeFeature 等修改返回值为 `Promise`，并添加了示例的 `await`。
  - `notification.md`: 后端调用的示例补充了 `await`。
  - `host.md`: `mulby.notification.show` 的示例代码前加上了 `await`。
  - `plugin-development-guide.md`: `onLoad` 修改为 `async`，并添加了后端 API 全异步的 Architecture 架构说明规则。
  - `utools-ztools-migration.md`: 针对 `utools.dbStorage` 的兼容映射增加了 `Promise` 和 `await` 的注意事项及代码更新。

## 2026-05-03 全局扫描并修复所有后端 API 的异步签名
- 编写 Node.js 脚本 `scripts/patch-docs.js` 遍历了 `docs/apis` 及 `skills/develop-mulby-plugin/references/apis` 下的全部文档。
- 将所有标记为 `[Backend]` 和 `[Renderer] [Backend]` 的同步返回值描述（如 `**返回值**: boolean` 或 `- 插件后端：void`）补充修改为插件后端返回 `Promise`。
- 将 `完整示例` 及各个接口示例代码中遗漏的后端 `context.api.*` 同步调用（如 `clipboard`、`filesystem`、`notification`、`shell`、`dialog`、`tray` 等）统一补齐了 `await`。
- 当前所有文档已全面符合“后端 API 必须 `await`”的核心架构规则。
