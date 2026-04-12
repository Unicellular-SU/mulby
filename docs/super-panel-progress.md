# Mulby 超级面板开发进展

> 更新时间：2026-04-11

## Phase 1: ✅ 已完成

超级面板功能的完整闭环已落地，包含 **6 个新建文件、8 个修改文件**，TypeScript + ESLint 双重验证通过。

### 模块清单

#### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/services/native-keyboard-sim.ts` | 零延迟键盘模拟（koffi FFI，< 5ms） |
| `src/main/services/super-panel-manager.ts` | 核心控制器（触发→黑名单→取词→匹配→显示） |
| `src/main/services/super-panel-window.ts` | 面板窗口管理器（智能定位，失焦隐藏） |
| `public/super-panel.html` + `.css` + `.js` | 面板前端 UI |
| `src/renderer/components/settings/sections/SuperPanelSection.tsx` | 设置页面 UI |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `shared/types/settings.ts` | 新增 SuperPanelSettings 类型 |
| `main/services/app-settings.ts` | 默认值 + 归一化 + 30+ 应用黑名单 |
| `preload/apis/platform-api.ts` | 暴露 superPanel IPC API |
| `shared/types/electron.d.ts` | 类型声明 |
| `main/ipc/settings.ts` | 设置变更回调 |
| `main/ipc/index.ts` | registerAllHandlers 扩展 |
| `main/index.ts` | 生命周期集成 + 资源清理 |
| `renderer/components/SettingsView.tsx` | 路由渲染 |

---

## Phase 2: ✅ 已完成

上下文感知与面板管理重构，包含 **3 个子任务、8 个修改文件**，TypeScript 编译通过。

### A. 上下文感知推荐系统

| 改动 | 说明 |
|------|------|
| `SuperPanelItem.contextBoost` | 新增上下文加权分字段 |
| `matchContent()` 加权逻辑 | 遍历 feature.cmds 的 `window` 类型，匹配当前前台应用时 `contextBoost = 3` |
| 排序公式 | `score + usageBoost + contextBoost` 三因子综合排序 |
| `SuperPanelState.activeApp` | 传入前端展示当前应用名 |
| 前端微标签 `为此应用推荐` | 上下文匹配的条目显示蓝色微标签 |
| Header 应用标签 | 显示当前前台应用名（紧凑标签样式） |

### B. Pinned 面板数据结构升级

| 改动 | 说明 |
|------|------|
| `SuperPanelGroup` / `SuperPanelLayout` 类型 | 分组结构，version: 2 |
| v1 → v2 自动迁移 | `load()` 检测旧 `pinnedItems[]` → 放入默认 "常用" 分组 |
| `getPinnedItemsForApp()` | 上下文感知：全局分组 + 匹配应用的分组 |
| `getGroupsForApp()` | 返回分组元信息（供前端分组渲染） |
| 分组管理方法 | `createGroup` / `deleteGroup` / `renameGroup` / `updateGroupBoundApp` / `reorderItem` / `reorderGroup` / `moveItemToGroup` |
| Manager 层 `buildPinnedGroups()` | 替代旧 `buildPinnedItems()`，按 activeWindow 过滤分组 |
| 前端分组渲染 | 多分组时显示分组标题和绑定应用标签 |
| IPC Action | 新增 7 个分组管理 action |

### C. 内联动作面板 (Action Panel)

| 改动 | 说明 |
|------|------|
| 触发方式 | `⌘/Ctrl+K` 或 右键 |
| 展现方式 | 列表项下方内联展开（动画 150ms） |
| 7 个动作 | 执行 / 固定(取消) / 移动到分组 / 复制捕获内容 / 禁用推荐 / 查看插件 |
| 单字母快捷键 | P/G/C/D/I 直接执行对应动作 |
| 窗口高度自适应 | `adjustHeight()` + `PANEL_MAX_HEIGHT` 520px |
| 禁用推荐 | 复用 PluginCommandDisabledToggle 机制 |
| 查看插件 | 关闭面板 → 跳转设置页插件详情 |

### 修改文件清单

| 文件 | 子任务 |
|------|--------|
| `src/main/services/super-panel-manager.ts` | A + B + C |
| `src/main/services/super-panel-store.ts` | B（完整重写） |
| `src/main/services/super-panel-window.ts` | C |
| `public/super-panel.html` | C |
| `public/super-panel.css` | A + B + C |
| `public/super-panel.js` | A + B + C |

---

## 待开发

- Phase 3: 自定义工作流（链式命令、条件分支、变量传递）
- 设置页分组管理 UI（SuperPanelSection.tsx 扩展）
- 拖拽排序支持（前端 HTML5 Drag API）
