# AI Tools 设置页面重构进展

**日期**: 2026-04-10
**状态**: ✅ 已完成

## 目标
将原有的 `AiToolSettingsModal`（弹出窗口式配置）重构为独立的全屏页面 `AiToolsSettingsView`，与 `AiSkillsSettingsView` 的体验保持一致。

## 阶段 1：路由基建 ✅
1. 更新 `system-page.ts`、`system-page-window-manager.ts`、`app-plugin-api.ts`、`electron.d.ts` 支持 `ai-tools-settings` 路由。
2. `App.tsx` 注册新视图模式。
3. `AiSettingsView` / `useAiSettingsViewModel` 剥离弹窗逻辑，使用路由跳转。

## 阶段 2：页面 UI 重新设计 ✅
**设计理念**: 参照 `AiSkillsSettingsView` 双栏布局，同时根据工具配置的数据特征进行全新设计。

**核心改动**:
- **双栏布局**: 左侧 280px 工具列表侧栏 + 右侧全宽详情区，为未来扩展更多 AI 工具预留。
- **Provider 卡片选择器**: 不再使用 `<select>` 下拉框，改为 ProviderCard 卡片组，每个搜索引擎/API/自定义 API 均为独立的交互式卡片，含图标/分组标签/激活态指示。
- **分区 Section 面板**: 「搜索引擎」「当前引擎配置」「API 密钥概览」「搜索参数」「自定义 API 管理」五大区块，各自独占圆角面板。
- **SVG 图标替代 Emoji**: 所有图标均使用内联 SVG，遵守 UI 设计规范。
- **添加自定义 API 弹窗**: `showAddCustomApi` 改为模态弹窗（与 AiSkillsSettingsView 的 zip/npx 安装弹窗风格一致）。
- **样式统一**: 使用与 Skills 页面相同的 class 定义（`inputClass`、`actionButtonClass`、`primaryPillClass`、`secondaryPillClass`），确保视觉一致性。

## 阶段 3：Plugin Tools 集成 ✅
**目标**: 在工具设置页面中展示和管理插件开放的 AI 工具接口，支持单独开关控制。

**改动**:
- **数据管线**:
  - `PluginInfo` 类型新增 `tools` 字段；`plugin:getAll` IPC 响应包含 `manifest.tools`。
  - `AiToolingSettings` 新增 `disabledPluginTools?: string[]` 字段，格式 `"pluginId:toolName"`。
  - `PluginToolRegistry.resolveToolsForAi()` 接受 `disabledKeys` 参数，跳过被禁用的工具。
  - 两个调用点（AI 管道注入 + OpenClaw）均读取 Settings 动态传入禁用集合。
- **IPC**:
  - `ai:tooling:pluginTools:getDisabled` — 获取禁用列表
  - `ai:tooling:pluginTools:setDisabled` — 更新禁用列表
- **Preload + Type**: `AiApi.tooling.pluginTools` 类型和 preload 桥接。
- **UI 布局重构**:
  - 侧栏采用 sidebar-detail 模式：每个有工具的插件作为独立侧栏项，badge 显示 `enabledCount/totalCount`。
  - 选中插件后，右侧面板展示：插件头部信息（图标/名称/状态标签/工具计数）+ 「全部启用/全部禁用」按钮。
  - 工具列表每行带独立 toggle switch（`no-drag`），禁用态使用删除线+灰色样式。
  - 修复 toggle 不响应点击的问题：所有交互元素添加 `no-drag` class 避免被 `-webkit-app-region: drag` 吞掉事件。

## 阶段 4：Code Review 修复 ✅

### [P2] 调用路径也执行禁用检查
**问题**: 之前只在 discovery 阶段（`resolveToolsForAi`）过滤禁用工具，但 AI tool dispatcher 和 OpenClaw `mulby.plugin.invoke` 的 invoke 路径不检查，直接绕过禁用设置执行工具。

**修复**:
- `src/main/index.ts` AI tool dispatcher: 在 `isPluginToolName(name)` 分支中，解析出 `pluginId:toolName` 后，立即检查 `disabledPluginTools` 列表，命中则 throw。
- `src/main/openclaw/handlers/mulby-handler.ts`: `MulbyHandlerDeps` 新增 `isToolDisabled?(pluginId, toolName)` 接口，在 toolId 和 pluginId+method 两种调用方式中均检查。
- `src/main/index.ts` OpenClaw deps 注入: 提供 `isToolDisabled` 实现，读取 `appSettings.aiTooling.disabledPluginTools`。

### [P3] UI 展示 registry 验证过的工具
**问题**: `plugin:getAll` IPC 直接暴露 `manifest.tools`，但 `PluginToolRegistry.refreshPlugin()` 会过滤无效 schema 和重复名称，导致 UI 展示的工具集与运行时不一致。

**修复**:
- `registerPluginHandlers` 签名新增可选参数 `pluginToolRegistry?: PluginToolRegistry`。
- `plugin:getAll` 响应中的 `tools` 字段改为从 `pluginToolRegistry.getPluginTools(p.id)` 获取，确保与运行时一致。
- 调用链: `registerAllHandlers` → `registerPluginHandlers` 透传 `pluginToolRegistry` 实例。
