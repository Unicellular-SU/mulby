# Task Plan: 图片生成能力驱动兼容实现

## Goal
将图片生成链路改为能力驱动策略（`stream-sse -> sync-json -> async-job -> sdk-direct`），避免按模型名写死，并保持统一进度事件。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Implement strategy chain
- [x] Phase 3: Add payload/async parsing and status mapping
- [x] Phase 4: Validate and deliver

## Key Questions
1. 如何避免 `glm-image` 这类模型与 OpenAI Image 固定 schema 不匹配导致失败？
2. 如何在不影响现有模型的前提下引入异步任务轮询？
3. 如何统一前端进度事件，避免 UI 感知底层协议差异？

## Decisions Made
- 在 `AiService` 增加策略能力缓存（按 providerType/baseURL/modelId）。
- 优先策略：`stream-sse`，失败后自动降级 `sync-json`，识别任务态后进入 `async-job`，最终 `sdk-direct` 兜底。
- 统一 JSON 容错解析和图片字段归一化（`b64_json/url/image/result/...`）。

## Errors Encountered
- TypeScript 联合类型收窄报错（`images/taskId` 字段访问）。
- 解决：新增类型守卫 `isImageCompatImagesResult` / `isImageCompatTaskResult`。

## Status
**Completed** - 已完成实现与验证（typecheck/build/test:unit 全部通过）
