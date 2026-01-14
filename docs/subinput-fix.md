# SubInput 问题修复

## 修复日期
2026-01-14

## 问题描述

1. **聚焦按钮无效**: 在 demo 中启用 SubInput 后，插件可以监听到子输入框中的内容，也能全选，但是聚焦按钮点击后无效
2. **SubInput 未清理**: 附着模式的插件退出以后，子输入框没有移除，导致输入框还是子输入框，无法搜索插件

## 根本原因分析

### 问题1:聚焦按钮无效
当插件调用 `subInput.focus()` 时：
1. 插件发送 IPC 消息 `subInput:focus` 到主进程
2. 主进程转发到主窗口的 webContents
3. 主窗口中的 SearchInput 组件调用 `inputRef.current?.focus()`

**问题**: 焦点实际上在面板窗口（插件窗口），而不是在主窗口。虽然输入框在代码层面获得了焦点，但主窗口本身没有被激活，所以焦点实际上不起作用。

### 问题2:SubInput 未清理
`closeAttached()` 方法只关闭了面板窗口和发送 `plugin:detached` 事件，但没有：
1. 发送 `subInput:disabled` 消息给渲染进程
2. 清理主进程中的 `subInputState` 变量

## 解决方案

### 修复1:聚焦前先激活主窗口
**文件**: `src/main/ipc/window.ts`

```typescript
// 子输入框获取焦点
ipcMain.on('subInput:focus', () => {
  const mainWin = getMainWindow()
  if (mainWin) {
    // 先聚焦主窗口，确保输入框能真正获得焦点
    mainWin.focus()
    mainWin.webContents.send('subInput:focus')
  }
})
```

### 修复2:关闭插件时清理SubInput
**文件**: `src/main/plugin/window.ts`

在 `closeAttached()` 和 `detachCurrent()` 方法中添加：
1. 调用 `clearSubInputState()` 清理主进程状态
2. 发送 `subInput:disabled` 消息给渲染进程

### 修复3:限制SubInput只在附着模式下可用
**文件**: `src/main/ipc/window.ts`

```typescript
ipcMain.handle('subInput:set', (event, placeholder?, isFocus?) => {
  // 检查调用者是否为面板窗口（附着模式）
  const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
  const callerWin = BrowserWindow.fromWebContents(event.sender)
  if (!panelWin || callerWin !== panelWin) {
    console.warn('[SubInput] Rejected: SubInput is only available in attached mode')
    return false
  }
  // ...
})
```

### 架构优化:提取SubInput状态管理
为避免循环依赖，创建了独立的 SubInput 状态管理模块：

**文件**: `src/main/services/subinput-state.ts`

```typescript
export function getSubInputState(): SubInputState
export function setSubInputState(state: Partial<SubInputState>): void
export function clearSubInputState(): void
export function isSubInputEnabled(): boolean
export function getSubInputOwnerId(): number
```

## 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/main/services/subinput-state.ts` | [NEW] 独立的 SubInput 状态管理模块 |
| `src/main/ipc/window.ts` | 使用新的状态管理模块；限制 SubInput 只在附着模式可用；聚焦时先激活主窗口 |
| `src/main/plugin/window.ts` | 在 closeAttached() 和 detachCurrent() 中清理 SubInput 状态 |

## 行为变更

1. **SubInput 只在附着模式下可用**: 独立模式的插件调用 `subInput.set()` 会返回 `false` 并有警告日志
2. **聚焦行为**: 调用 `subInput.focus()` 时会先激活主窗口
3. **退出清理**: 无论通过何种方式关闭附着插件（ESC、outPlugin、切换插件等），SubInput 状态都会被正确清理

## 验证
- TypeScript 类型检查通过
- 需要手动测试验证修复效果
