# Task Plan: AI 主进程落地（Vercel AI SDK 适配层）

## Goal
在现有项目结构中落地主进程 AI API 与插件/渲染端调用，并建立基础模块骨架。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research/gather information
- [x] Phase 3: Execute/build
- [x] Phase 4: Review and deliver

## Key Questions
1. 如何在现有主进程结构中新增 AI 模块与 IPC？
2. 如何为插件 API 与渲染端补充 AI 调用能力？
3. 依赖版本与 SDK API 是否正确？

## Decisions Made
- 使用 Vercel AI SDK Core 与 Provider 模块作为统一适配层。
- AI 配置存储在 userData/ai/settings.json。
- 工具调用暂不执行，仅记录并忽略。

## Errors Encountered
- None

## Status
**Completed** - 已完成模块与接口落地
