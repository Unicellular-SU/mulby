# Mulby 技术架构设计（代码对齐版）

> 最后更新：2026-02-28  
> 对齐基准：`src/main`、`src/preload`、`src/renderer` 当前实现。

## 1. 架构概览

Mulby 采用 Electron 三层架构：

1. 主进程（`src/main`）
- 窗口与生命周期管理
- IPC 注册与系统能力桥接
- 插件加载/执行/调度
- AI、任务调度、日志、托盘、设置管理

2. 预加载层（`src/preload`）
- 通过 `contextBridge` 暴露受控 API（`window.mulby`）
- 屏蔽主进程实现细节，提供稳定调用面

3. 渲染层（`src/renderer`）
- React UI（主界面、设置中心、插件管理、任务调度等）
- 仅通过 `window.mulby` 与主进程通信

## 2. 插件运行架构

当前插件运行模型：

- 以 Node.js 能力为主
- 主链路为插件宿主/工作进程（UtilityProcess + Host 管理）
- 插件 API 由 `src/main/plugin/api.ts` 统一构建
- 插件窗口由 `PluginWindowManager` 管理，支持附着与分离模式
- 后台插件由 `BackgroundPluginManager` 管理

> 状态：Python 插件运行时方案已废弃，不在近期路线。

## 3. 目录与模块（当前实现）

```text
src/
  main/
    index.ts                 # 主进程入口
    ipc/                     # IPC handler 注册与实现
    plugin/                  # 插件系统（加载、运行、窗口、宿主、商店）
    ai/                      # AI 能力（provider、skills、mcp、tools）
    scheduler/               # 任务调度核心
    services/                # 应用服务（设置、日志、托盘、快捷键等）
    db/                      # 数据存储
  preload/
    index.ts                 # window.mulby API 暴露
  renderer/
    App.tsx                  # UI 宿主
    components/              # 设置、插件管理、任务调度等页面组件
  shared/
    types/                   # 主/渲染共享类型
```

## 4. API 暴露策略

- IPC 处理器统一注册于 `src/main/ipc/index.ts`
- API 暴露统一在 `src/preload/index.ts`
- 类型声明统一在 `src/shared/types/electron.d.ts`
- 插件运行时 API 在 `src/main/plugin/api.ts`

文档与代码冲突时，以以上文件为准。

## 5. 当前工程关注点

- 质量门禁（lint/test/typecheck）
- 大文件拆分与模块边界收敛
- 设置中心增强（开机自启动、更新中心）
- 调度器前端从轮询改为事件驱动
- CI 最小发布前检查链路
