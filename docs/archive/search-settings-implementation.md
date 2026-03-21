# 搜索设置功能实现进展

## 功能概述

允许用户在"通用设置"中通过两个开关控制搜索行为：

- **搜索本机应用**（`enableApps`）：默认开启
- **搜索本机文件**（`enableFiles`）：默认关闭

## 实现状态：✅ 已完成

### 第一阶段：UI 与配置持久化 ✅

| 文件 | 修改内容 |
|------|----------|
| `src/shared/types/settings.ts` | 新增 `SearchSettings` 接口并集成到 `AppSettings` |
| `src/main/services/app-settings.ts` | 添加默认值 (`enableApps: true`, `enableFiles: false`) 和合并逻辑 |
| `src/renderer/components/settings/sections/GeneralSection.tsx` | 添加两个开关 UI 元素 |
| `src/renderer/components/SettingsView.tsx` | 传递 search settings props |

### 第二阶段：搜索逻辑集成 ✅

| 文件 | 修改内容 |
|------|----------|
| `src/main/ipc/desktop.ts` | **主进程守卫**：IPC handler 中读取设置，关闭对应开关时直接返回空数组 |
| `src/renderer/components/PluginList.tsx` | **渲染进程优化**：组件挂载时读取设置，`shouldSearchApps/Files` 条件中检查开关值 |
| `src/main/index.ts` | **启动优化**：预热应用搜索索引时检查 `enableApps` 开关 |

## 架构设计

采用**双层防护**策略，确保可靠性：

```
用户切换设置开关
    ↓
渲染进程 (PluginList.tsx)
    ├── 读取 searchSettingsRef.current.enableApps/enableFiles
    ├── 关闭时：跳过 IPC 调用（性能优化）
    └── 开启时：发起 IPC 调用
         ↓
主进程 IPC Handler (ipc/desktop.ts)
    ├── 实时读取 appSettingsManager.getSettings().search
    ├── 关闭时：返回空数组（防御层）
    └── 开启时：调用 DesktopSearchService
         ↓
系统搜索服务 (search/service.ts)
    └── 调用平台特定搜索 provider (darwin/win/linux)
```

### 关键设计决策

1. **渲染层使用 Ref 而非 State**：避免因 settings 变更触发无谓的搜索 effect 重新执行
2. **IPC handler 实时读取设置**：确保即使渲染层 ref 未更新，主进程也能正确响应最新设置
3. **PluginList 每次挂载时刷新设置**：组件在窗口显示/隐藏周期中会重新挂载，自动获取最新值
4. **预热逻辑受守卫保护**：关闭应用搜索时不浪费 CPU 预热索引
