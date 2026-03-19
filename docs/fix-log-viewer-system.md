# 日志系统修复总结

## 问题描述

日志查看器（LogViewerView）存在以下问题：
1. **不显示任何日志** — 日志列表始终为空
2. **插件筛选下拉框看不到任何插件** — 因为没有日志数据，pluginIds 为空
3. **插件中 console.log 打印的日志不可见** — 只有 error/warn 被拦截
4. **插件的报错不可见** — 开发者模式关闭时所有日志被静默丢弃

## 根因分析

| # | 问题 | 文件 | 原因 |
|---|------|------|------|
| 1 | console.log/info 未捕获 | `error-capture.ts` | 只拦截了 `console.error` 和 `console.warn`，未拦截 `console.log` 和 `console.info` |
| 2 | 开发者模式守卫过严 | `ipc/log.ts` | `log:write` 在 `developer.enabled === false` 时直接 return，丢弃所有日志 |
| 3 | 未利用 Electron 原生事件 | `window.ts`, `panel-window.ts` | 未监听 `webContents.on('console-message')` 事件 |
| 4 | Host Worker 输出未入库 | `host-manager.ts` | UtilityProcess 的 stdout/stderr 只打到主进程 console，未写入 loggerService |

## 修复方案

### 架构设计：单一捕获路径

**核心原则**：插件 console 输出只通过一条路径捕获 — 主进程侧的 `webContents.on('console-message')` 事件。

- ✅ **console-capture.ts（主进程侧）** — 唯一的 console 日志捕获路径，使用 `plugin.id`
- ✅ **error-capture.ts（preload 层）** — 仅负责 uncaught error / unhandled rejection
- ❌ 不在 preload 层覆写 console.*（避免与 `patchConsoleWithTimestamp` 冲突导致重复日志和 ID 不一致）

### 1. error-capture.ts — 移除所有 console 覆写
- 移除 `console.log/info/warn/error` 覆写
- 只保留 `window.addEventListener('error')` 和 `window.addEventListener('unhandledrejection')`
- 消除与 `patchConsoleWithTimestamp` 时间戳前缀冲突导致的去重失败

### 2. ipc/log.ts — 移除开发者模式守卫 + 修正 pluginId 提取顺序
- 移除 `getDeveloperModeEnabled()` 检查
- **修正 `getPluginIdFromSender` 优先级**：先从 URL 路径提取 `plugin.id`（最准确），再回退到窗口标题
- 解决 displayName vs id 导致同一插件出现两个标识的问题

### 3. console-capture.ts — 新增主进程侧 console 捕获
- 创建 `installConsoleCapture()` 函数
- 通过 Electron 的 `webContents.on('console-message')` 事件捕获
- 始终使用 `plugin.id` 作为标识，与 IPC 路径保持一致
- 在 `window.ts` 和 `panel-window.ts` 中的所有插件窗口创建点安装

### 4. host-manager.ts — Worker stdout/stderr 转发
- 将 UtilityProcess 的 stdout 数据写入 `loggerService.write('info', ...)`
- 将 UtilityProcess 的 stderr 数据写入 `loggerService.write('error', ...)`

## Codex Review 修复

| Issue | 描述 | 修复 |
|-------|------|------|
| P1 | console 日志重复写入（patchConsoleWithTimestamp 导致去重失败） | 移除 preload 层 console 覆写，仅在主进程侧通过 console-message 事件捕获 |
| P2 | 同一插件出现两个 ID（displayName vs id） | 修正 getPluginIdFromSender 优先从 URL 提取 plugin.id |

## 修改文件列表

| 文件 | 操作 |
|------|------|
| `src/preload/apis/error-capture.ts` | 移除 console 覆写，只保留错误监听 |
| `src/main/ipc/log.ts` | 移除开发者模式守卫 + 修正 pluginId 提取优先级 |
| `src/main/ipc/index.ts` | 清理已移除的导出引用 |
| `src/main/plugin/console-capture.ts` | **新建** — 主进程侧 console 捕获（唯一路径） |
| `src/main/services/logger.ts` | 移除不再需要的 writeFromConsoleMessage |
| `src/main/plugin/window.ts` | 安装 console 捕获到独立/辅助窗口 |
| `src/main/plugin/panel-window.ts` | 安装 console 捕获到面板/promote 窗口 |
| `src/main/plugin/host-manager.ts` | Worker stdout/stderr 转发到日志系统 |
| `src/renderer/components/LogViewerView.tsx` | 更新空状态提示文案 |
