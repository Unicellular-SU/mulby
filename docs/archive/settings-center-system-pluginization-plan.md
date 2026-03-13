# 设置中心系统插件化迁移方案

## 目标

把“设置中心”从 App 内部硬编码页面，逐步演进为“系统插件（system plugin）”，最终与普通插件共享统一的指令、窗口、快捷键与生命周期模型，同时保证每个阶段都能独立上线。

## 总体迁移阶段

### Phase 1：渲染层宿主抽象（本次启动）

- 目标：先抽象，不改变业务行为与主进程窗口行为。
- 变更：
  - 在渲染进程引入 `system-plugin` 视图模式。
  - 新增 `SystemPluginHost` 与系统插件路由类型，设置页通过宿主渲染。
  - 将原 `settings` 分支迁移为 `settings-center` 系统插件路由。
- 验收：
  - 现有设置页所有入口保持可用（快捷键、命令入口、按钮入口）。
  - 设置页内各 Tab、命令快捷启动/全部指令行为不回退。
  - 与设置页互跳的页面（插件管理、日志、任务调度、运行中插件）返回逻辑不变。

### Phase 2：系统插件导航协议

- 目标：统一“打开设置中心”的入口协议，消除 App 内部特判。
- 变更：
  - 定义 `app:openSystemPlugin` 事件（`pluginId + params`）。
  - App 中 `openSettings` 语义收敛为 `openSystemPlugin('settings-center', ...)`。
  - 为系统插件引入最小路由协议（section/query/commandHint）。
- 验收：
  - 所有设置入口均走统一协议。
  - 能通过参数直达 `快捷启动`、`全部指令` 等子区块。

### Phase 3：主进程系统插件窗口编排

- 目标：让设置中心具备“附着/独立”窗口能力，贴近 uTools 体验。
- 变更：
  - 新增 `SystemPluginWindowManager`（可先复用 `PluginPanelWindow` 能力）。
  - “从设置打开附着模式插件”前，先退出设置系统插件，再恢复搜索态并挂载目标插件窗口。
  - 允许设置中心切换为独立窗口（与普通插件一致的窗口控制能力）。
- 验收：
  - 不再出现“设置窗口在上层，插件附着窗口压在底部”的层级问题。
  - 设置中心可在附着/独立两种模式下稳定工作。

### Phase 4：设置中心能力插件化

- 目标：把设置中心页面能力拆成系统插件 manifest + feature 集合。
- 变更：
  - 为 `settings-center` 定义系统插件 manifest（内置、不可卸载）。
  - 把设置子页映射为 feature/route；接入现有命令模型（功能指令/匹配指令）。
  - 接入命令启用/禁用与全局快捷键绑定能力。
- 验收：
  - 设置中心可被“指令系统”与“快捷键系统”统一调度。
  - 设置入口从“特殊页面”变为“系统插件指令”。

### Phase 5：统一观测与回归保障

- 目标：确保系统插件化后的稳定性、可回滚性、可观测性。
- 变更：
  - 增加窗口切换、指令打开、快捷键触发的埋点与日志。
  - 补齐关键集成测试（打开设置、设置内跳转、从设置打开插件、快捷键触发）。
  - 保留开关（feature flag）支持阶段性灰度与回滚。

## 本次（Phase 1）已落地内容

- 新增 `src/renderer/system-plugins/types.ts`，定义系统插件路由模型。
- 新增 `src/renderer/system-plugins/SystemPluginHost.tsx`，作为系统插件渲染宿主。
- `App.tsx` 引入 `system-plugin` 视图模式，并将设置中心改为 `settings-center` 路由渲染。
- 保持设置相关返回目标语义（`settings`）不变，仅映射到新的 `system-plugin` 视图。

## Phase 2（进行中）已落地内容

- 新增 main -> renderer 事件协议：`app:openSystemPlugin`，payload 形态为 `pluginId + params`。
- `openSettingsView` 与“指令快捷键跳转设置”入口均已改为走 `app:openSystemPlugin`。
- 渲染层已改为监听 `window.mulby.app.onOpenSystemPlugin`，并按 payload 解析设置中心 section 与快捷指令 hint。

## Phase 3（进行中）已落地内容

- 主进程新增 `SystemPluginWindowManager`，负责系统插件激活态记录与“附着插件前置收拢”协调。
- 当系统插件处于激活态且即将打开附着模式插件时，主进程会发送 `app:systemPluginBeforeAttach`，等待渲染确认后再执行 `attachPlugin`。
- 渲染层新增系统插件状态上报（`systemPlugin:setActive`）与就绪回执（`systemPlugin:notifyReadyForAttach`）闭环。
- `PluginManager.run()` 在附着模式分支接入该协调流程，解决“设置页打开附着插件窗口层级异常”问题。

## Phase 1 未做（刻意延后）

- 未改插件窗口管理器（附着/独立窗口逻辑不变）。
- 未把设置中心拆成真正的系统插件 manifest/feature（先完成宿主化）。

## 风险与控制

- 风险：渲染路由重构导致返回路径断裂。
  - 控制：保持原 return target 语义不变，仅做映射替换。
- 风险：命令快捷启动入口参数丢失。
  - 控制：系统插件路由中保留 `shortcutCommandHint`，消费后清空。
- 风险：后续阶段跨度过大。
  - 控制：每一阶段均保持“可上线、可回滚、可单测”。
