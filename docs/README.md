# Mulby 文档索引

> 最后更新：2026-02-28

## 文档分层

### 0) 代码优先原则（必须遵守）
- 文档是代码的说明，不是代码的替代。
- 接口与行为以 `src/` 实现为准；文档仅做同步表达。
- 若文档与代码冲突：先修文档，再讨论是否调整代码。
- API 对齐基准：
  - `src/preload/index.ts`
  - `src/main/ipc/index.ts`
  - `src/main/plugin/api.ts`
  - `src/shared/types/electron.d.ts`

### 1) 核心产品文档（长期维护）
- `PRD.md`：产品需求
- `architecture.md`：技术架构
- `plugin-spec.md`：插件开发规范
- `api-reference.md`：API 总参考
- `api-status.md`：API 状态快照（代码对齐）
- `ui-design.md`：UI/UX 规范
- `roadmap.md`：项目路线图
- `TASKS.md`：当前任务追踪
- `task_plan.md`：当前阶段执行计划

### 2) API 细分文档（长期维护）
- `apis/README.md` 及 `apis/*.md`

### 3) 专题设计/方案（按需维护）
- `background-plugin-design.md`
- `task-scheduler-design.md`
- `settings-and-plugin-management-design.md`
- `settings-center-system-pluginization-plan.md`
- `plugin-architecture-refactor.md`
- `plugin-dev-workflow.md`
- `plugin-packaging.md`
- `window-api-enhancement.md`
- `inbrowser-api-design.md`
- `attachment-manager-design.md`
- `ai-*.md` 系列专题文档

### 4) 历史归档（不作为当前实现依据）
- `archive/` 目录下文档

## 维护约定
- 新增文档优先放在与主题对应的目录，不在根目录堆叠临时文档。
- 阶段完成报告、一次性总结、进度快照，完成后迁移到 `docs/archive/`。
- `roadmap.md`、`TASKS.md`、`task_plan.md` 需保持与当前代码实现一致。
- 若文档与代码冲突，以代码为准，并在本次迭代内修正文档。
