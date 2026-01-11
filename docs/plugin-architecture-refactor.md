# 插件架构重构方案

> **文档版本**: v1.0  
> **创建日期**: 2026-01-11  
> **状态**: 开发中

## 目标

1. **完全进程隔离**: 插件崩溃不影响主进程，恶意插件无法杀死主进程
2. **统一窗口模式**: 使用"跟随窗口"BrowserWindow 替代 WebView 附着模式
3. **安全加固**: IPC 速率限制 + Watchdog + 资源监控

---

## 设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 模式转换触发 | 点击"弹出"按钮 | 不支持拖拽自动升级 |
| WebView 回退 | ❌ 已移除 | 完全使用 Panel 模式 |
| 面板默认高度 | 550px | 可根据内容调整 |
| 窗口跟随方式 | 最佳实践 | 保证移动时无割裂感 |
| 工具栏设计 | Shadow DOM | 样式完全隔离，不受插件影响 |

---

## 架构设计

### 新架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Main Process                               │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  PluginManager  │  │PluginHostManager │  │ PluginWindowManager│  │
│  │  (加载/卸载)    │  │ (UtilityProcess) │  │   (窗口管理)       │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘  │
│           │                    │                      │             │
│  ┌────────▼────────────────────▼──────────────────────▼───────────┐ │
│  │                         IPC Gateway                            │ │
│  │  - Rate Limiter (速率限制)                                     │ │
│  │  - Watchdog (看门狗)                                           │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┬┘
                                                                     │
     ┌───────────────────────────────────────────────────────────────┘
     │
     │  IPC
     │
┌────▼─────────────┐     ┌────────────────────┐     ┌─────────────────┐
│  Main Window     │     │ Plugin Panel (跟随) │     │ Plugin Window   │
│  (搜索框)        │     │ (Parent-Child)     │     │ (独立窗口)      │
│  - 轻量 UI       │     │ - 无边框 550px     │     │ - 有标题栏      │
│  - 无插件代码    │◄───►│ - 跟随主窗口       │────►│ - 可拖拽/调整   │
│                  │     │ - 面板展示         │     │ - 完全独立      │
└──────────────────┘     └────────────────────┘     └─────────────────┘
        │                         │                         │
        └─────────────────────────┴─────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     UtilityProcess        │
                    │   (Plugin Host/Backend)   │
                    │   - 重型计算              │
                    │   - 文件/网络操作         │
                    │   - 完全隔离              │
                    └───────────────────────────┘
```

### 窗口跟随实现

为保证移动搜索框时面板窗口无割裂感，采用以下策略：

1. **macOS**: 使用 `parent` 选项建立父子关系，子窗口自动跟随
2. **Windows/Linux**: 使用 `requestAnimationFrame` 级别的位置同步
3. **防抖优化**: 避免高频位置更新导致的性能问题

```typescript
// 关键配置
const panelConfig = {
  parent: mainWindow,           // 父子关系
  skipTaskbar: true,            // 不在任务栏显示
  alwaysOnTop: true,            // 保持在最前
  movable: false,               // 禁止直接拖动
  resizable: true,              // 允许调整大小
  frame: false,                 // 无边框
  height: 550                   // 默认高度
}
```

---

## 文件变更清单

### 新增文件

| 文件路径 | 描述 |
|----------|------|
| `src/main/plugin/panel-window.ts` | 跟随面板窗口管理 |
| `src/main/plugin/host-manager.ts` | UtilityProcess 插件宿主管理 |
| `src/main/plugin/host-worker.js` | 插件宿主工作进程 |
| `src/preload/rate-limiter.ts` | IPC 速率限制器 |

### 修改文件

| 文件路径 | 变更内容 |
|----------|----------|
| `src/main/plugin/window.ts` | 重构为统一窗口管理，移除 WebView 模式 |
| `src/renderer/App.tsx` | 移除 WebView/PluginContainer 渲染逻辑 |
| `src/shared/types/electron.d.ts` | 更新 onPluginAttach 类型定义 |
| `src/preload/index.ts` | 添加速率限制包装（待完成） |

### 删除文件

| 文件路径 | 说明 |
|----------|------|
| `src/renderer/components/PluginContainer.tsx` | WebView 容器，已不再需要 |

---

## 开发进度

### 第一阶段：Panel Window 系统 (预计 2-3 天)

| 任务 | 状态 | 完成日期 |
|------|------|----------|
| 创建 `PluginPanelWindow` 类 | ✅ 已完成 | 2026-01-11 |
| 实现父子窗口位置同步 | ✅ 已完成 | 2026-01-11 |
| 实现 Panel → Window 转换 | ✅ 已完成 | 2026-01-11 |
| 测试崩溃隔离效果 | ⬜ 待测试 | |

### 第二阶段：移除 WebView 模式 (已完成)

| 任务 | 状态 | 完成日期 |
|------|------|----------|
| 更新 `PluginWindowManager` | ✅ 已完成 | 2026-01-11 |
| 移除 WebView 模式代码 | ✅ 已完成 | 2026-01-11 |
| 更新 App.tsx 渲染逻辑 | ✅ 已完成 | 2026-01-11 |
| 删除 PluginContainer.tsx | ✅ 已完成 | 2026-01-11 |
| 更新类型定义 | ✅ 已完成 | 2026-01-11 |

### 第三阶段：UtilityProcess 后端 (预计 3-4 天)

| 任务 | 状态 | 完成日期 |
|------|------|----------|
| 创建 `PluginHostManager` | ⬜ 待开始 | |
| 实现 Plugin Host Worker | ⬜ 待开始 | |
| 迁移高风险 API | ⬜ 待开始 | |
| 建立窗口 ↔ Host 通信 | ⬜ 待开始 | |

### 第四阶段：安全加固 (预计 1-2 天)

| 任务 | 状态 | 完成日期 |
|------|------|----------|
| 实现 IPC 速率限制 | ⬜ 待开始 | |
| 添加 Watchdog 监控 | ⬜ 待开始 | |
| 测试恶意插件防护 | ⬜ 待开始 | |

---

## 测试计划

### 功能测试

1. **面板跟随**: 移动搜索框，面板无缝跟随
2. **模式转换**: 点击弹出按钮，面板变为独立窗口
3. **崩溃隔离**: 插件崩溃不影响主窗口
4. **工具栏隔离**: Shadow DOM 确保工具栏样式不受插件影响

### 性能测试

1. **窗口同步延迟**: < 16ms (60fps)
2. **IPC 速率限制**: 超过阈值正确阻断
3. **内存占用**: 对比 WebView 模式

### 安全测试

1. **无限循环插件**: 不影响主进程
2. **IPC 洪水攻击**: 被速率限制阻断
3. **恶意代码执行**: 沙箱隔离有效

---

## 变更日志

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-01-11 | v1.0 | 初始设计文档创建 |
| 2026-01-11 | v1.1 | 完成 Phase 1: 创建 PluginPanelWindow 类，实现位置同步和模式转换 |
| 2026-01-11 | v1.2 | 优化工具栏: 移到底部中央，使用 Shadow DOM 隔离样式 |
| 2026-01-11 | v1.3 | 完成 Phase 2: 完全移除 WebView 模式，统一使用 Panel 窗口 |

---

## 参考资料

- [Electron UtilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron BrowserWindow parent option](https://www.electronjs.org/docs/latest/api/browser-window)
- [VS Code Extension Host Architecture](https://code.visualstudio.com/api/advanced-topics/extension-host)
