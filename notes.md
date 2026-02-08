# Notes: AI 主进程落地

## Sources
- npm view (ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google)

## Key Versions
- ai: 6.0.67
- @ai-sdk/openai: 3.0.25
- @ai-sdk/anthropic: 3.0.35
- @ai-sdk/google: 3.0.20

## Implementation Notes
- 新增 src/main/ai 模块与 IPC
- 预留多模态/附件/成本估算接口
- tools 执行暂未实现

## Image Generation Notes
- 增加了图片生成稳态链路：网络中断重试 + base64 解码兜底（支持 data URL / URL / base64 统一归一）。
- 增加了 `images.generateStream`：主进程、IPC、preload、插件 API 全链路支持进度回调。
- 流式路径优先尝试 `stream + partial_images`，不支持时自动回退普通生成。

## Notes: 图片生成协议兼容研究（2026-02-08）

### 外部资料结论
- 智谱图像生成有同步与异步两条：`/images/generations` + `/async/images/generations`，并通过 `/async-result/{id}` 查询结果。
- OpenAI/AI SDK 生态里，图像“进度”主要来自事件流（partial image）或任务态轮询，而不是统一百分比。
- AI SDK `generateImage` 是同步结果接口；对 OpenAI image 解析以 `b64_json` 为中心，兼容层若返回其他结构会触发解析失败。

### Cherry Studio 代码证据
- Zhipu 绘图页只给 cogview 模型，并在页面层强制 `cogview` 前缀。
- Zhipu client 使用 `sdk.images.generate` 同步请求并取 `response.data[].url`。
- TokenFlux 已有标准异步任务实现（create -> poll -> status）。
- OpenAI Responses 支持 `partial_images` 与 `response.image_generation_call.partial_image` 事件。

### 方案方向
- 不做单模型特判；改为能力驱动策略链：`stream-sse -> sync-json -> async-job`。
- 统一状态事件与输出归一化，以 provider 能力映射和探测结果驱动。
