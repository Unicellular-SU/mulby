# Task Plan: 图片生成协议兼容方案研究（2025-2026）

## Goal
基于 2025-2026 年公开最佳实践与 Cherry Studio 现有实现，给出不写死模型名的图片生成兼容方案。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research/gather information
- [x] Phase 3: Synthesize architecture options
- [x] Phase 4: Deliver recommendation

## Key Questions
1. 2025-2026 主流 SDK/厂商对图片生成“进度/流式/异步任务”有哪些共识？
2. Cherry Studio 当前实现采用了哪些策略，边界在哪里？
3. 如何设计成能力驱动策略链，避免写死 `glm-image`？

## Decisions Made
- 采用“能力驱动而非模型名驱动”的方案。
- 建议策略链：`stream-sse -> sync-json -> async-job`。
- 统一进度事件协议与输出归一化，降低 provider 差异对 UI 的影响。

## Errors Encountered
- 无阻塞性错误。

## Status
**Completed** - 已完成外部资料与本地实现对照分析，并输出方案文档 `image-compat-strategy-2026.md`
