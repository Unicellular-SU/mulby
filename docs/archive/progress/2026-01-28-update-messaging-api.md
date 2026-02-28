# 进展更新 - 2026-01-28

## 已完成任务
- [x] 更新 `packages/mulby-cli/PLUGIN_DEVELOP_PROMPT.md`
  - 补充了 `messaging` API 的接口定义。
  - 包含 `send`, `broadcast`, `on`, `off` 方法。
- [x] 更新 `packages/mulby-cli/src/commands/create/templates/react.ts`
  - 在 React 模板中添加了 `messaging` API 的支持。
  - 更新了 `useMulby` hook，增加了 `messaging` 方法。
  - 更新了全局类型定义 `buildMulbyTypes`，增加了 `MulbyMessaging` 接口。
  - 更新了后端上下文 `buildBackendMain`，增加了 `messaging` API 定义。

## 下一步计划
- 确认是否有其他模板需要更新（如 Vue 模板？）。
- 确认 CLI build 流程是否正常。
