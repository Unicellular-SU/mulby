# 插件搜索体验及管理增强方案 (Plugin Search Enhancements)

## 1. 背景 (Background)
目前 `PluginList.tsx` 卡片的交互仅停留在“单击执行”及右键“查看插件详情”。为了增强用户体验并实现个性化展示与高级管理功能，本文档基于系统现有架构设计了一系列针对右键菜单和搜索匹配流程的优化方案。

## 2. 增强目标 (Objectives)
基于用户反馈与头脑风暴，计划支持以下扩展管理操作：
1. **针对插件与最近使用 (Plugin / Recent)**
   - 置顶 / 取消置顶 (Pin / Unpin)
   - 隐藏 / 停用该功能 (Hide / Ignore feature)
   - 从最近使用中移除 (Remove from Recent)
   - 直接前往设置 / 绑定快捷键 (Assign Hotkey / Settings)
   - 复制唤醒链接 (Copy URL Scheme)
   - 一键卸载此插件 (Uninstall Plugin)
2. **针对系统应用与文件 (System App / System File)**
   - 复制 Base64/PNG 图标图像 (Copy System Icon)
   - 以管理员身份运行 (Run as Administrator)
   - 用默认编辑器 / 其它应用打开 (Open with...)
3. **视觉与排列联动**
   - 不单独设立置顶区，但在主搜索发生时，若被固定过的插件命中了查询结果，提权（Boost）至结果项的第 1 位。
   - 对所有处于置顶状态的结果提供一个小型的 `Pin` 图标点缀视觉标识。

---

## 3. 架构与实现设计 (Architecture & Design)

### 3.1 状态存储层 (Storage Layer)
目前主进程内部有一个专门用于管控用户配置的类 `PluginStateManager` (`src/main/plugin/state.ts`)，并在磁盘维护至 `plugin-state.json`。
我们将于该类和对应的配置类型中新增 `SearchPreferences`。

**`src/shared/types/plugin.ts` 新增类型:**
```typescript
export interface PinnedFeature {
  pluginId: string;
  featureCode: string;
  pinnedAt: number;
}

export interface HiddenFeature {
  pluginId: string;
  featureCode: string;
  hiddenAt: number;
}

export interface SearchPreferenceState {
  pinnedFeatures: PinnedFeature[];
  hiddenFeatures: HiddenFeature[];
}
```

**`src/main/plugin/state.ts` 变更:**
- `PluginStateManager` 原有结构内加一个针对 `searchPreferences` 的维护接口。
- 新增 `getSearchPreferences()`, `pinFeature()`, `unpinFeature()`, `hideFeature()`, `unhideFeature()` 等方法持久化修改属性，并触发 `this.save()` 落盘。
- 新增 `removeRecentUsage(pluginId, featureCode)` 方法，提供清理单条最近使用的入口。

### 3.2 IPC 通信层 (IPC & API)
为渲染侧（Frontend）暴露对应的操控接口：

**`src/shared/types/electron.d.ts`:**
```typescript
interface ElectronAPI {
  // ...
  plugin: {
    // ...
    getSearchPreferences: () => Promise<SearchPreferenceState>;
    pinFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>;
    unpinFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>;
    hideFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>;
    removeRecentUsage: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>;
  }
}
```
**`src/main/ipc/plugin.ts`:**
将新定义的进程通信频道绑定至 `PluginStateManager` 的对应方法内。

### 3.3 渲染交互层 Frontend (`PluginList.tsx`)
核心检索呈现与用户界面。

#### a. 数据预载入与同步
- 组件 `Mount` 挂载时，通过 `window.mulby.plugin.getSearchPreferences()` 调用，初始化拿到 `pinned` 和 `hidden` 各自的数据数组并存储为 React state 状态 `searchPreferences`。

#### b. 隐藏与打分排列预处理
搜索出来的 `pluginResults` 和 `recentPlugins`：
1. **隐藏剔除 (Filter)**：进入 `bestPlugins` 和 `recentDisplayItems` 前，只要检索到数据流其匹配 `hiddenFeatures` 数组列表中的 `[pluginId, featureCode]` 组合，直接抛弃不予渲染。
2. **混合吸顶 (Ranking)**：在计算 `getSearchScore` 内拦截，若目标当前为 Pin 置顶（命中 `pinnedFeatures`），强行补正极大分数（如 `score += 10000`）。这样原本搜索相关的内容排在第一的同时兼顾了其它高相关内容也能展出。

#### c. 上下文菜单动态渲染体系 (Context Menu)
目前右键菜单项定义于 `handleItemContextMenu` 方法。我们需要将其进行扩展：

```typescript
// 针对 Item == Plugin / Recent
if (isPinned) {
  menuItems.push({ id: 'unpin-feature', label: '取消置顶' })
} else {
  menuItems.push({ id: 'pin-feature', label: '置顶此项' })
}
menuItems.push({ id: 'hide-feature', label: '隐藏此功能' })

if (item.type === 'recent') {
  menuItems.push({ id: 'remove-recent', label: '从最近使用中移除' })
}
menuItems.push({ id: 'sep', label: '', separator: true })
menuItems.push({ id: 'config-shortcut', label: '配置快捷键' }) // 导航进 CommandQuickLaunch
menuItems.push({ id: 'copy-link', label: '复制启动链接' })

menuItems.push({ id: 'sep2', label: '', separator: true })
menuItems.push({ id: 'uninstall', label: '卸载此插件', danger: true }) // 高危直接删除操作
```

#### d. 视觉小修改 (Visual Indication)
对 `ResultCard` 这个纯享用组件做 Props 的修改。增加 `isPinned: boolean` 入参，若 `true` 时，在元素的极右侧放置一个深灰色或主色的“图钉”小型 SVG (`<PinIcon />`)，以确保即便和其它项混排，视觉仍有明确区分。

---

## 4. 后续推进 (Next Steps)
该设计遵循了松耦合及易配置的原则。与外部 Worker 无需进行复杂的关联运算，全部依靠前端轻重排以及主进程单纯持久化配置达成。审核完毕即可立即可进入 Implementation Executing 阶段。
