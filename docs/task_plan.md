# Task Plan: 2026-02-28 工程质量与产品演进执行计划

## Goal
在不扩张范围的前提下，完成工程质量门禁、文档治理、设置中心增强（开机自启动/更新中心）、CI 基建、核心大文件拆分和任务调度器事件驱动改造。

## Scope Baseline（已确认）

### In Scope
- 质量门禁打通（lint / test / typecheck / 构建 smoke）
- 文档更新与清理（删除无效/陈旧文档，保留并重写有效文档）
- 设置中心新增：开机自启动 + 更新中心入口与能力
- CI 落地（最少 lint + unit test + build smoke）
- 大文件拆分（降低耦合与回归风险）
- 任务调度器 UI 从轮询改为事件驱动

### Deferred / Out of Scope（本轮不做）
- 插件商店安全增强（签名、校验链）
- Python 插件运行时（废弃）
- i18n 多语言体系（待定）

## Phases
- [x] Phase 1: 计划冻结与文档治理基线
- [x] Phase 2: 质量门禁修复与基线稳定
- [x] Phase 3: 设置中心增强（开机自启动 + 更新中心）
- [x] Phase 4: CI 建设与发布前自动检查
- [x] Phase 5: 大文件拆分与模块边界收敛
- [x] Phase 6: 任务调度器事件驱动改造
- [x] Phase 7: 验收回归与文档收口

## Phase Details

### Phase 1: 计划冻结与文档治理基线
**目标**：让文档与当前代码状态一致，并明确删改策略。  
**工作项**：
- 盘点 `docs/` 文档，按「保留/更新/归档/删除」四类标记
- 更新路线图与任务文档（去除 Python 运行时计划、标注 i18n 待定）
- 建立文档索引页（标注每份文档状态与最近更新时间）
- 输出删除清单并执行清理

**验收标准**：
- `docs/` 下无明显过期且与实现冲突的核心文档
- 有一份清晰可读的文档索引可指引后续维护

### Phase 2: 质量门禁修复与基线稳定
**目标**：本地质量门禁可稳定通过。  
**工作项**：
- 修复 lint error（先清 error，再按优先级消减 warning）
- 修复 `test:unit` 失败用例（含 Electron 依赖环境隔离）
- 建立本地统一检查命令（如 `npm run verify`）

**历史基线（修复前）**：
- `lint`: 58 errors / 324 warnings
- `test:unit`: 140 项中 1 项失败（`skillsService.test.ts`）

**验收标准**：
- `npm run typecheck` 通过
- `npm run lint` 无 error
- `npm run test:unit` 全通过
- build smoke 通过

**当前结果（2026-02-28）**：
- `npm run typecheck`: 通过
- `npm run lint`: 0 error / 348 warnings
- `npm run test:unit`: 149 tests, 0 fail, 1 skip
- `npm run build`（smoke）: 通过
- 已新增 `npm run verify` 统一执行质量门禁链路

### Phase 3: 设置中心增强（开机自启动 + 更新中心）
**目标**：设置中心可直接管理开机自启动，并提供更新能力入口。  
**工作项**：
- 在设置页新增「启动与更新」区块（或等价结构）
- 接入开机自启动状态读取与切换能力
- 设计并接入更新中心最小能力（手动检查、版本展示、跳转/安装策略）
- 补充对应的主进程 IPC/类型定义/错误处理

**验收标准**：
- 用户无需托盘菜单即可在设置中完成开机自启动开关
- 更新中心入口可用，状态可见，失败可提示

**当前结果（2026-02-28）**：
- 设置中心按信息架构落位：
  - 「开机自启动」放入「通用」
  - 「更新中心」放入「关于」
- 已接入开机自启动状态读取与切换（macOS / Windows）
- 已接入更新中心最小能力：
  - 当前版本 / 最新版本 / 最近检查时间展示
  - 手动检查更新（GitHub latest release）
  - 打开发布页（默认 `https://github.com/Unicellular-SU/mulby/releases`）
- 新增 IPC 与 preload API：
  - `settings:startup:getOpenAtLogin` / `settings:startup:setOpenAtLogin`
  - `settings:updateCenter:getState` / `settings:updateCenter:check` / `settings:updateCenter:openReleasePage`

### Phase 4: CI 建设与发布前自动检查
**目标**：提交后自动执行最小可发布检查。  
**工作项**：
- 新增 CI 工作流（建议 GitHub Actions）
- 流水线步骤：依赖安装 -> typecheck -> lint -> unit test -> build smoke
- 补充失败日志可读性和最小缓存策略

**验收标准**：
- 任一质量门禁失败会阻断 CI
- 主分支合并前可见完整检查结果

**当前结果（2026-02-28）**：
- 已新增 GitHub Actions 工作流：`.github/workflows/ci.yml`
- 已接入流水线步骤：
  - install (`npm ci`)
  - typecheck (`npm run typecheck`)
  - lint (`npm run lint`)
  - unit test (`npm run test:unit`)
  - build smoke (`npm run build:smoke`)
- 已配置最小缓存策略：`actions/setup-node@v4` + `cache: npm`
- 本地同链路验证通过：`npm run verify`

### Phase 5: 大文件拆分与模块边界收敛
**目标**：降低超大文件维护风险，明确模块职责。  
**优先拆分候选（按体量与风险）**：
- `src/main/ai/service.ts`
- `src/preload/index.ts`
- `src/main/plugin/manager.ts`
- `src/renderer/components/SettingsView.tsx`
- `src/renderer/components/PluginManagerView.tsx`

**工作项**：
- 先按“纯搬运 + 接口不变”拆分，再做小步重构
- 为拆分后模块补充单测/回归点
- 控制每次改动面，避免大爆炸重构

**验收标准**：
- 核心对外接口不变
- 拆分后行为无回归，质量门禁持续通过

**当前结果（2026-02-28）**：
- 已完成 `src/preload/index.ts` 两轮拆分（接口保持不变）：
  - 第一轮模块：
    - `src/preload/apis/ai.ts`
    - `src/preload/apis/sharp.ts`
    - `src/preload/apis/ffmpeg.ts`
    - `src/preload/apis/mulby-main-api.ts`
    - `src/preload/apis/error-capture.ts`
  - 第二轮模块：
    - `src/preload/apis/core-api.ts`
    - `src/preload/apis/app-plugin-api.ts`
    - `src/preload/apis/platform-api.ts`
    - `src/preload/apis/log-api.ts`
- `src/preload/index.ts` 由 1174 行降至 50 行（改为组装入口）
- 已统一目录规范：`src/preload/` 下除 `index.ts` 外的实现文件全部迁移到 `src/preload/apis/`
- 回归验证：
  - `npm run typecheck` 通过
  - `npm run test:unit` 通过（149 tests, 0 fail, 1 skip）
- 后续补充拆分（2026-03-02）：
  - `src/renderer/components/AiSettingsView.tsx` 拆为布局层 + ViewModel + controller 组合层
  - `useAiSettingsController.ts` 拆为 `Provider/Model/Modal` 子 hook
  - `ProviderSettingsSection.tsx` 拆为 `ProviderSidebar` / `ProviderConfigPanel` / `ProviderModelsPanel`
  - `ProviderModelsPanel.tsx` 继续拆为 `ProviderModelsHeader` / `ModelCapabilitiesEditor` / `ModelParamsEditor`
  - 拆分后门禁持续通过（typecheck/lint/test:unit/build:smoke）
- 本轮追加拆分（2026-03-02）：
  - `src/main/ai/service.ts` 按职责拆分为：
    - `src/main/ai/service/openai-compat-stream.ts`
    - `src/main/ai/service/utils.ts`
    - `src/main/ai/service/image-helpers.ts`
    - `src/main/ai/service/stream-helpers.ts`
    - `src/main/ai/service/provider-helpers.ts`
    - `src/main/ai/service/message-converters.ts`
    - `src/main/ai/service/anthropic-helpers.ts`
    - `src/main/ai/service/upload-helpers.ts`
  - `src/main/ai/service.ts` 从 4527 行降至 2793 行（保留 `AiService` 对外接口不变）
  - 继续拆分（2026-03-03）：
    - `buildTools` 链路抽离到 `src/main/ai/service/tool-builders.ts`
    - image pipeline 抽离到 `src/main/ai/service/image-pipeline.ts`
    - provider call 编排抽离到 `src/main/ai/service/provider-call-orchestration.ts`
    - provider stream 编排抽离到 `src/main/ai/service/provider-stream-orchestration.ts`
    - reply aggregation 抽离到 `src/main/ai/service/reply-aggregation.ts`
    - testConnection 链路抽离到 `src/main/ai/service/test-connection.ts`
    - fetchModels 链路抽离到 `src/main/ai/service/fetch-models.ts`
    - `src/main/ai/service.ts` 进一步降至 1413 行
  - 继续拆分（2026-03-03）：
    - `resolveMergedTools` 链路抽离到 `src/main/ai/service/merged-tools.ts`
    - capability 注入链路抽离到 `src/main/ai/service/capability-injection.ts`
    - `src/main/ai/service.ts` 进一步降至 1218 行
  - 继续拆分（2026-03-03）：
    - OpenAI compat tool-loop/context 组装收口到 `src/main/ai/service/openai-compat-bridge.ts`
    - provider 编排依赖收口到 `src/main/ai/service/provider-orchestration-deps.ts`
    - provider model 解析收口到 `src/main/ai/service/provider-model-resolvers.ts`
    - `src/main/ai/service.ts` 进一步降至 974 行
  - 继续拆分（2026-03-03）：
    - `resolveCompatBaseURL` 收口到 `src/main/ai/service/compat-base-url.ts`
    - test/fetch provider shared deps 收口到 `src/main/ai/service/provider-shared-deps.ts`
    - `src/main/ai/service.ts` 进一步降至 936 行
  - 继续拆分（2026-03-03）：
    - generation params 收口到 `src/main/ai/service/generation-params.ts`
    - provider context + 上传链路依赖装配收口到 `src/main/ai/service/provider-orchestration-deps.ts`
    - `src/main/ai/service.ts` 进一步降至 893 行
  - 回归验证：
    - `npm run typecheck` 通过
    - `npm run lint` 通过（0 error / 310 warnings）
    - `npm run test:unit` 通过（149 tests, 0 fail, 1 skip）
    - `npm run build:smoke` 通过

### Phase 6: 任务调度器事件驱动改造
**目标**：替代前端高频轮询，减少资源消耗并提升状态实时性。  
**工作项**：
- 主进程新增调度事件流（任务变化、执行状态变化、统计变化）
- 渲染层订阅事件并增量更新 UI
- 保留兜底手动刷新与断线恢复逻辑

**验收标准**：
- 默认路径不再依赖 1s 轮询
- 列表/详情状态更新及时且无明显跳变

**当前结果（2026-03-02）**：
- 主进程新增调度事件订阅通道：
  - `scheduler:subscribe` / `scheduler:unsubscribe`
  - 事件通道 `scheduler:event`
  - 事件类型覆盖：`task:created/cancelled/paused/resumed/success/failed`、`tasks:deleted/cleaned`
- 调度核心补充批量删除/清理事件发射：
  - `tasks:deleted`
  - `tasks:cleaned`
- preload 与类型层已对齐：
  - `window.mulby.scheduler.subscribe()`
  - `window.mulby.scheduler.unsubscribe()`
  - `window.mulby.scheduler.onEvent(callback)`
- 渲染层 `TaskSchedulerView` 改造完成：
  - 移除 1s `setInterval` 的网络轮询
  - 改为事件驱动刷新（含任务详情联动刷新）
  - 保留手动刷新 + 断线兜底恢复（低频 fallback + focus/visibility 恢复）
  - 倒计时显示采用本地 1s tick 重渲染（仅刷新 UI，不触发网络请求）
- 回归验证：
  - `npm run typecheck` 通过
  - `npm run test:unit` 通过（149 tests, 0 fail, 1 skip）
  - `npm run build:smoke` 通过

### Phase 7: 验收回归与文档收口
**目标**：确保变更可交付并可维护。  
**工作项**：
- 全量回归（功能 + 质量门禁 + 打包 smoke）
- 更新 `docs/TASKS.md`、`docs/roadmap.md`、相关设计文档
- 输出变更说明与后续 backlog（含插件商店安全）

**验收标准**：
- 回归通过
- 文档状态与实现一致
- 后续 backlog 清晰

**当前结果（2026-03-03）**：
- 全量门禁回归通过：`npm run typecheck` + `npm run lint` + `npm run test:unit` + `npm run build:smoke`
  - `typecheck`: 通过
  - `lint`: 0 error / 310 warnings
  - `test:unit`: 149 tests, 0 fail, 1 skip
  - `build:smoke`: 通过
- 文档已同步：
  - `docs/TASKS.md`：基线结果与剩余任务更新
  - `docs/roadmap.md`：阶段状态与下一轮优先级更新
- 后续 backlog（按优先级）：
  1. lint warnings 分批治理（先业务代码，再类型声明与测试文件）
  2. 继续细化 `src/main/ai/service.ts`（当前约 893 行，优先降低 `stream()` 主链路可读性复杂度）

## Key Questions
1. 更新中心第一版采用“内置下载/安装”还是“仅检查并跳转发布页”？
2. lint warning 是否本轮一次性清零，还是先按模块分批治理？
3. 文档清理策略是否采用“删除优先”，还是“先归档后删除”？

## Decisions Made
- 本轮优先工程质量和可维护性，不扩张到插件商店安全。
- Python 插件运行时从路线中移除。
- i18n 保持待定，不在本轮实施。
- 设置中心增强、CI、大文件拆分、调度器事件驱动均纳入本轮。
- 历史阶段报告/进度快照统一迁移到 `docs/archive/`，活跃目录仅保留当前可执行文档。
- lint warnings 采用“分批治理”策略，不在本轮一次性清零。
- `src/main/plugin/manager.ts` 和 `src/renderer/components/PluginManagerView.tsx` 拆分从本轮移除，仅保留 `src/main/ai/service.ts` 拆分。

## Errors Encountered
- `planning-with-files` 技能仓库内路径不可用，已切换到 `$HOME/.codex/skills/planning-with-files/SKILL.md` 读取。
- `test:unit` 初始失败触发 `better-sqlite3` ABI 不匹配；已通过 `AiSkillService` 中默认 `command-runner` 懒加载隔离测试导入路径。

## Status
**Phase 7 Completed（2026-03-03）** - 当前轮次收口完成，进入下一轮 backlog 执行（以大文件拆分收尾和 warnings 治理为主）。
