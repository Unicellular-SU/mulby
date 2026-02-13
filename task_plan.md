# Task Plan: Agent Skills 官方规范一次性达标改造

## Goal
使项目 `src/main/ai` 的 Skills 设计与运行链路符合 `agentskills.io` 官方定义与规范，并完成单测与 UI 验收。

## Phases
- [x] Phase 1: 规范模型与校验器（严格 frontmatter + 字段约束）
- [x] Phase 2: Skills 服务链路改造（创建/安装/导入/刷新/解析全入口硬校验）
- [x] Phase 3: 渐进披露与注入策略（启动仅元数据，激活再加载正文）
- [x] Phase 4: metadata 命名空间落地（`metadata.mulby.*` 承载扩展能力）
- [x] Phase 5: IPC/预加载/UI 适配（错误语义、状态展示、创建约束）
- [x] Phase 6: 测试与文档收口（新增规范测试 + 全量回归）

## Key Questions
1. 不合规 Skill 处理策略？（已定：立即硬校验，直接拒绝）
2. 交付范围？（已定：全量一次到位，不做迁移工具）
3. 扩展字段放置策略？（已定：`metadata` 命名空间）

## Decisions Made
- 官方字段严格对齐：`name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。
- 平台扩展字段迁移到 `metadata.mulby.*`，不再写入顶层。
- 启动扫描只解析 frontmatter；正文在技能激活时按需读取。
- 全链路阻断不合规技能，提供可读错误信息。

## Errors Encountered
- 暂无

## Status
**Completed** - 官方规范改造已完成，`test:unit` 与 `typecheck` 均通过。
