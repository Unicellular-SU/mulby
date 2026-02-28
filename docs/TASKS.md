# Mulby 开发任务跟踪

> 最后更新：2026-02-28
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
- [ ] 建立最小 CI 流水线（typecheck + lint + test + build smoke）

### P0 - 文档治理
- [x] 建立阶段任务计划（`docs/task_plan.md`）
- [x] 盘点并清理历史文档，迁移到 `docs/archive/`
- [x] 建立文档索引与维护规范
- [x] 同步核心文档与当前实现状态（代码对齐修补）

## Planned

### P1 - 产品体验增强
- [ ] 设置中心：开机自启动管理
- [ ] 设置中心：更新中心入口与状态展示

### P1 - 可维护性
- [ ] 拆分超大文件：
  - [ ] `src/main/ai/service.ts`
  - [ ] `src/preload/index.ts`
  - [ ] `src/main/plugin/manager.ts`
  - [ ] `src/renderer/components/SettingsView.tsx`
  - [ ] `src/renderer/components/PluginManagerView.tsx`

### P2 - 性能与架构
- [ ] 任务调度器 UI 改为事件驱动（替代 1s 轮询）

## Deferred / Not Planned (This Cycle)
- [ ] 插件商店安全增强（后期专题）
- [ ] Python 插件运行时（废弃）
- [ ] i18n 多语言体系（待定）

## 验收门槛（本轮）
- `npm run typecheck` 通过
- `npm run lint` 无 error
- `npm run test:unit` 全通过
- build smoke 通过

## 最近基线结果（2026-02-28）
- `typecheck`: 通过
- `lint`: 0 error / 354 warnings
- `test:unit`: 149 tests, 0 fail, 1 skip
- `build smoke`: 通过
