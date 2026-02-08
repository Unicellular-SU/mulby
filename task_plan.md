# Task Plan: AI Skills Integration Implementation

## Goal
Implement end-to-end AI Skills for `src/main/ai`, including create/install/manage/preview, main AI invocation, and plugin AI invocation.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Core types and main-process skills service
- [x] Phase 3: AI pipeline + IPC/preload/plugin API integration
- [x] Phase 4: Renderer UI + tests + verification + delivery

## Key Questions
1. How to integrate skills without breaking existing `ai.call` behavior?
2. How to enforce MCP least-privilege when skills participate in calls?
3. What minimum UI/API surface completes the end-to-end skill lifecycle?

## Decisions Made
- Use local planning files (`task_plan.md`, `notes.md`) to track research and architecture decisions.
- Base design on current repository AI runtime + MCP implementation rather than a greenfield abstraction.
- Delivery scope is end-to-end in this iteration.
- Supported skill sources in this iteration: local directory, ZIP, and JSON import.

## Errors Encountered
- None.

## Status
**Completed** - End-to-end skills implementation delivered and verified by typecheck, unit tests, and build.
