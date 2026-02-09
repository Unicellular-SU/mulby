# Task Plan: AI Capability Policy 解耦迁移实施

## Goal
按 `docs/ai-capability-policy-decoupling-migration-plan.md` 落地第一阶段编码：能力授权从 Skill/source 维度解耦到 AI 全局策略，同时保持兼容行为。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Types + settings 迁移能力（globalGrants/legacy）
- [x] Phase 3: capability-policy 运行时裁决改造（全局优先，兼容 scoped grants）
- [x] Phase 4: SettingsView UI 解耦（移除 Skill/source 矩阵）
- [x] Phase 5: 测试更新 + typecheck + AI tests

## Key Questions
1. 兼容期是否保留 scoped grants 的运行时生效能力？（是，默认保留）
2. 是否在设置页继续暴露 defaultSkill/defaultNetwork 默认项？（否，本次隐藏并只保留 global 语义）
3. 迁移时是否自动提升 scoped allow 到全局 allow？（否，避免权限意外扩大）

## Decisions Made
- 按“全局策略主路径 + scoped grants 兼容窗口”实施。
- `globalGrants` 作为 UI 与策略主入口；`grants` 保留兼容与历史数据。
- 设置页移除按 Skill/source 矩阵，只保留全局能力策略与中文说明。

## Errors Encountered
- `capabilities.test.ts` 里优先级断言与实现不一致（写成了 session allow 覆盖 global deny）。
  - 处理：将测试修正为 global deny 优先。

## Status
**Completed** - 迁移方案已按第一阶段实现并通过 typecheck 与能力策略测试。
