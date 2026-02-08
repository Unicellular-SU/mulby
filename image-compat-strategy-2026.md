# 图片生成兼容方案（2025-2026 研究结论）

## 目标
构建“能力驱动”的图片生成协议层，避免按模型名写死（如只特判 `glm-image`），并统一进度体验。

## 关键观察

### 1) 业界接口形态已明显分化
- 同步 JSON：一次返回最终结果（可能是 `b64_json` 或 `url`）。
- 流式事件：返回阶段事件 + partial image（如 OpenAI Responses 的 `response.image_generation_call.partial_image`）。
- 异步任务：先返回任务 ID，再轮询/回调获取最终结果。

### 2) `glm-image` 更接近“异步任务优先”能力
- 智谱官方文档存在单独异步图像生成接口：`POST /api/paas/v4/async/images/generations`。
- 并提供统一查询接口：`GET /api/paas/v4/async-result/{id}`。
- 同步图像接口文档虽然列出 `glm-image-v1`，但响应语义与 OpenAI Image `b64_json` 强绑定并不一致（通常返回 URL 语义）。

### 3) Cherry Studio 的实现也体现“分协议处理”
- Zhipu 绘图页面仅暴露 cogview 模型：`cs/src/renderer/src/pages/paintings/config/ZhipuConfig.ts`。
- 页面层强制模型前缀是 `cogview`：`cs/src/renderer/src/pages/paintings/ZhipuPage.tsx`。
- 另有独立异步任务范式（create + poll + status）：`cs/src/renderer/src/pages/paintings/utils/TokenFluxService.ts`。
- 对 OpenAI Responses，支持 image partial/delta 事件：`cs/src/renderer/src/aiCore/legacy/clients/openai/OpenAIResponseAPIClient.ts`。

### 4) AI SDK 现状
- `generateImage` 是同步 Promise 结果接口（无官方 `streamImage` 对等 API）。
- OpenAI image provider 的响应 schema 对 `b64_json` 假设很强；不匹配时会在 JSON/schema 解析处失败。

## 推荐架构（不写死模型名）

## 1. 引入三段式策略链（按能力，不按模型）
1. `stream-sse`：支持 SSE/事件流 + partial image。
2. `sync-json`：支持单次 JSON 返回（兼容 `b64_json|url|image|result|data[]`）。
3. `async-job`：返回任务 ID，轮询状态直至完成。

执行顺序建议：
- 首选 `stream-sse`（体验最好）；
- 首字节超时或明确不支持时，降级 `sync-json`；
- 检测到“任务态响应”或同步解析失败且命中任务特征时，自动切 `async-job`。

## 2. 能力探测与缓存
- 启动时或首次调用时做轻量探测：
  - 是否支持 `stream=true`。
  - 是否支持 `partial_images`。
  - 成功响应是 `b64_json` 还是 `url`。
  - 是否返回 `id/task_status` 任务态。
- 将结果按 `(providerId, baseURL, model)` 缓存（TTL + 失败熔断）。

## 3. 统一进度协议（UI 无感知底层差异）
- 统一事件：`start | partial | finalizing | completed | fallback | error`。
- `stream-sse`：直接映射事件和 partial image。
- `sync-json`：使用 heartbeat（秒表）+阶段提示（无百分比）。
- `async-job`：将 provider `task_status` 映射为阶段（queued/processing/finalizing/completed）。

## 4. 统一输出归一化
- 输出统一为：`{ imagesBase64: string[], metadata }`。
- 兼容输入：
  - `b64_json` / data URL / 纯 base64
  - `url`（下载后二进制转 base64）
  - 其他供应商字段（`image`/`result`/`data[].*`）

## 5. 失败与降级策略
- 区分三类错误：
  - 传输层：超时/断连（可重试）
  - 解析层：非 JSON/schema 不匹配（可切换策略）
  - 业务层：模型/参数不支持（不重试）
- 在日志中记录：策略命中、降级原因、耗时、上游 request-id。

## 为什么这比“glm-image 特判”更好
- 不依赖单模型名，能覆盖未来同类 provider/模型差异。
- 兼容新模型时，通常只需补“能力映射”而非改主流程。
- 降低“看起来 200 OK，实际不可用”这类隐式失败。

## 建议实施顺序
1. 先抽象 `ImageExecutionStrategy` 接口与三策略骨架（不改 UI）。
2. 接入 capability cache + metrics。
3. 将现有 `generateImagesStream` 对接新策略链。
4. 加入 provider 适配器最小元数据（端点、轮询字段、状态映射）。
5. 回归测试：OpenAI、OpenAI-compatible、Zhipu(cogview/glm-image)、慢网关、非 JSON 响应。
