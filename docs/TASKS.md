# Mulby 开发任务跟踪

> 最后更新：2026-03-03
> 维护原则：仅保留当前与近期可执行任务，历史完成记录统一归档到 `docs/archive/`。

## 当前版本
- `v0.1.x-dev`

## 当前阶段
- 阶段 A：工程稳定与治理

## In Progress

### P0 - 质量与发布基线
- [x] 修复 `lint` error（目标：0 error）
- [x] 修复 `test:unit` 失败用例并稳定通过
- [x] 建立统一本地验证命令（`npm run verify`）
- [x] 建立最小 CI 流水线（typecheck + lint + test + build smoke）

### P0 - 文档治理
- [x] 建立阶段任务计划（`docs/task_plan.md`）
- [x] 盘点并清理历史文档，迁移到 `docs/archive/`
- [x] 建立文档索引与维护规范
- [x] 同步核心文档与当前实现状态（代码对齐修补）

## Planned

### P1 - 产品体验增强
- [x] 设置中心：开机自启动管理
- [x] 设置中心：更新中心入口与状态展示

### P1 - 可维护性
- [x] 拆分超大文件：
  - [x] `src/main/ai/service.ts`（已拆分为 `service/*` 子模块，接口保持不变）
  - [x] `buildTools` 链路抽离到 `src/main/ai/service/tool-builders.ts`
  - [x] image pipeline 抽离到 `src/main/ai/service/image-pipeline.ts`
  - [x] provider call 编排抽离到 `src/main/ai/service/provider-call-orchestration.ts`
  - [x] provider stream 编排抽离到 `src/main/ai/service/provider-stream-orchestration.ts`
  - [x] reply aggregation 抽离到 `src/main/ai/service/reply-aggregation.ts`
  - [x] testConnection 链路抽离到 `src/main/ai/service/test-connection.ts`
  - [x] fetchModels 链路抽离到 `src/main/ai/service/fetch-models.ts`
  - [x] `resolveMergedTools` 链路抽离到 `src/main/ai/service/merged-tools.ts`
  - [x] capability 注入链路抽离到 `src/main/ai/service/capability-injection.ts`
  - [x] OpenAI compat tool-loop/context 组装收口到 `src/main/ai/service/openai-compat-bridge.ts`
  - [x] provider 编排依赖收口到 `src/main/ai/service/provider-orchestration-deps.ts`
  - [x] provider model 解析收口到 `src/main/ai/service/provider-model-resolvers.ts`
  - [x] `resolveCompatBaseURL` 收口到 `src/main/ai/service/compat-base-url.ts`
  - [x] test/fetch provider shared deps 收口到 `src/main/ai/service/provider-shared-deps.ts`
  - [x] generation params 收口到 `src/main/ai/service/generation-params.ts`
  - [x] provider context + 上传链路依赖装配收口到 `src/main/ai/service/provider-orchestration-deps.ts`
  - [x] `src/preload/index.ts`
  - [x] `src/renderer/components/SettingsView.tsx`
  - [x] `src/renderer/components/AiSettingsView.tsx`（含 controller/hook 分层）

### P2 - 性能与架构
- [x] 任务调度器 UI 改为事件驱动（替代 1s 网络轮询，倒计时保留本地 1s UI 刷新）

## Deferred / Not Planned (This Cycle)
- [ ] 插件商店安全增强（后期专题）
- [ ] Python 插件运行时（废弃）
- [ ] i18n 多语言体系（待定）
- [ ] `src/main/plugin/manager.ts` 拆分（本轮取消）
- [ ] `src/renderer/components/PluginManagerView.tsx` 拆分（本轮取消）

## 验收门槛（本轮）
- `npm run typecheck` 通过
- `npm run lint` 无 error
- `npm run test:unit` 全通过
- build smoke 通过

## 最近基线结果（2026-03-03）
- `typecheck`: 通过
- `lint`: 0 error / 310 warnings
- `test:unit`: 149 tests, 0 fail, 1 skip
- `build smoke`: 通过

## Next Backlog（优先级）
1. lint warnings 分批治理（先 AI 主链路，再测试与类型声明文件）。
2. 继续细化 `src/main/ai/service.ts`（当前约 893 行，优先降低 `stream()` 主链路可读性复杂度）。
