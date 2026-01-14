# Window API 增强计划

> 基于 uTools 官方窗口 API 文档对比分析，规划 InTools 窗口 API 的增强实现。

## 概述

本文档基于 [uTools 窗口 API 文档](https://www.u-tools.cn/docs/developer/utools-api/window.html) 进行对比分析，规划需要补充和增强的 API。

## 对比分析

### ✅ 已实现的 API

| uTools API | InTools API | 状态 |
|------------|-------------|------|
| `hideMainWindow()` | `window.hide()` | ✅ 已实现 |
| `showMainWindow()` | `window.show()` | ✅ 已实现 |
| `showOpenDialog()` | `dialog.showOpenDialog()` | ✅ 独立模块 |
| `showSaveDialog()` | `dialog.showSaveDialog()` | ✅ 独立模块 |
| `isDarkColors()` | `theme.getActual()` | ✅ 已实现 |

### ⚠️ 部分实现的 API

| uTools API | 现状 | 需要修改 |
|------------|------|----------|
| `setExpendHeight(height)` | `window.setSize(w, h)` 需宽高 | 添加 `setHeight()` |
| `getWindowType()` | `window.getMode()` 缺少类型 | 添加 `'browser'` 类型 |
| `createBrowserWindow()` | `window.create()` 功能受限 | 增强回调和控制 |
| `hideMainWindow(isRestore)` | `window.hide()` 缺少参数 | 添加可选参数 |

### ❌ 缺失的 API

| API | 功能 | 优先级 |
|-----|------|--------|
| `setSubInput()` | 子输入框控制 | 🔴 高 |
| `removeSubInput()` | 移除子输入框 | 🔴 高 |
| `setSubInputValue()` | 设置子输入框值 | 🔴 高 |
| `subInputFocus()` | 子输入框获取焦点 | 🔴 高 |
| `subInputBlur()` | 子输入框失去焦点 | 中 |
| `subInputSelect()` | 选中子输入框文本 | 中 |
| `redirect()` | 跳转到其他插件 | 🔴 高 |
| `outPlugin()` | 退出插件 | 🔴 高 |
| `sendToParent()` | 向父窗口发消息 | 🔴 高 |
| `findInPage()` | 页面内查找 | 低 |
| `stopFindInPage()` | 停止页面内查找 | 低 |
| `startDrag()` | 原生文件拖拽 | 中 |

---

## 实现计划

### Phase 1: 子输入框系统 (SubInput)

子输入框是 uTools 的核心交互模式，让插件可以复用主窗口的搜索栏作为输入源。

#### 设计方案

```
┌─────────────────────────────────────────────┐
│ InTools                              [─][□][×] │
├─────────────────────────────────────────────┤
│  🔍 [          子输入框 (SubInput)         ] │  ← 主窗口搜索栏
├─────────────────────────────────────────────┤
│                                             │
│              插件内容区域                    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 新增 API

```typescript
interface IntoolsWindow {
  // ... 现有 API

  /**
   * 设置子输入框
   * @param onChange 输入变化回调
   * @param placeholder 占位符文本
   * @param isFocus 是否自动聚焦
   */
  setSubInput(
    onChange: (data: { text: string }) => void,
    placeholder?: string,
    isFocus?: boolean
  ): boolean

  /**
   * 移除子输入框
   */
  removeSubInput(): boolean

  /**
   * 设置子输入框值
   */
  setSubInputValue(text: string): void

  /**
   * 子输入框获取焦点
   */
  subInputFocus(): void

  /**
   * 子输入框失去焦点
   */
  subInputBlur(): void

  /**
   * 选中子输入框全部文本
   */
  subInputSelect(): void
}
```

#### 实现文件

| 文件 | 变更 |
|------|------|
| `src/main/ipc/window.ts` | 添加 SubInput 相关 IPC handlers |
| `src/preload/index.ts` | 暴露 SubInput API |
| `src/renderer/` | 主窗口搜索栏组件支持 SubInput 模式 |
| `plugins/*/intools.d.ts` | 更新类型定义 |

---

### Phase 2: 插件导航 (redirect & outPlugin)

实现插件间跳转和退出控制。

#### 新增 API

```typescript
interface IntoolsWindow {
  /**
   * 跳转到另一个插件
   * @param label 插件标识或 [插件名, 功能名]
   * @param payload 传递的数据
   */
  redirect(label: string | [string, string], payload?: any): boolean

  /**
   * 退出当前插件
   * @param isKill 是否彻底结束进程 (默认 false 隐藏到后台)
   */
  outPlugin(isKill?: boolean): boolean
}
```

#### 实现文件

| 文件 | 变更 |
|------|------|
| `src/main/ipc/window.ts` | 添加 redirect, outPlugin handlers |
| `src/main/plugin/manager.ts` | 插件切换逻辑 |
| `src/preload/index.ts` | 暴露 API |

---

### Phase 3: 窗口间通信 (sendToParent)

由 `createBrowserWindow` 创建的窗口需要与主窗口通信。

#### 新增 API

```typescript
interface IntoolsWindow {
  /**
   * 向父窗口发送消息 (仅 createBrowserWindow 创建的窗口可用)
   */
  sendToParent(channel: string, ...args: any[]): void

  /**
   * 监听子窗口消息 (主窗口使用)
   */
  onChildMessage(callback: (channel: string, ...args: any[]) => void): void
}
```

#### 增强 createBrowserWindow

```typescript
interface IntoolsWindow {
  /**
   * 创建独立浏览器窗口 (增强版)
   * @param url 相对路径 HTML 文件
   * @param options BrowserWindow 选项
   * @param callback 页面加载完成回调
   * @returns 窗口控制对象
   */
  createBrowserWindow(
    url: string,
    options?: BrowserWindowOptions,
    callback?: () => void
  ): BrowserWindowProxy
}

interface BrowserWindowProxy {
  id: number
  show(): void
  hide(): void
  close(): void
  focus(): void
  setTitle(title: string): void
  setSize(width: number, height: number): void
  setPosition(x: number, y: number): void
  postMessage(channel: string, ...args: any[]): void
  onMessage(callback: (channel: string, ...args: any[]) => void): void
}
```

---

### Phase 4: 参数增强 & 工具 API

#### 4.1 hideMainWindow 增强

```typescript
/**
 * 隐藏主窗口
 * @param isRestorePreWindow 是否恢复到之前的活动窗口 (默认 true)
 */
hide(isRestorePreWindow?: boolean): void
```

#### 4.2 getWindowType 增强

```typescript
/**
 * 获取当前窗口类型
 * @returns 'main' | 'detach' | 'browser'
 *   - main: 主窗口 (附着模式)
 *   - detach: 分离的独立窗口
 *   - browser: createBrowserWindow 创建的窗口
 */
getWindowType(): 'main' | 'detach' | 'browser'
```

#### 4.3 setExpendHeight

```typescript
/**
 * 设置插件区域高度 (宽度固定)
 */
setExpendHeight(height: number): void
```

#### 4.4 startDrag

```typescript
/**
 * 从插件拖拽文件到其他应用
 * @param filePath 文件路径或路径数组
 */
startDrag(filePath: string | string[]): void
```

#### 4.5 findInPage

```typescript
/**
 * 页面内查找
 */
findInPage(text: string, options?: {
  forward?: boolean
  findNext?: boolean
  matchCase?: boolean
}): { requestId: number; matches: number; activeMatchOrdinal: number } | null

/**
 * 停止页面内查找
 */
stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
```

---

## 实现优先级

| 阶段 | 功能 | 复杂度 | 预计时间 |
|------|------|--------|----------|
| **Phase 1** | SubInput 子输入框系统 | 🔴 高 | 2-3 天 |
| **Phase 2** | redirect + outPlugin | 🟡 中 | 1 天 |
| **Phase 3** | 窗口间通信增强 | 🟡 中 | 1-2 天 |
| **Phase 4** | 参数增强 + 工具 API | 🟢 低 | 0.5 天 |

---

## 验证计划

### 自动化测试

由于窗口 API 涉及 Electron 主进程和渲染进程交互，难以使用纯单元测试验证。建议：

1. **IPC Handler 测试**: 使用 `@electron/spectron` 或模拟 IPC 事件
2. **TypeScript 编译检查**: 确保类型定义正确

### 手动验证

在 `intools-showcase` 插件中添加 Window API 展示模块：

1. **SubInput 测试**
   - 点击 "启用子输入框" → 验证搜索栏变为子输入
   - 输入文本 → 验证 onChange 回调触发
   - 点击 "移除子输入框" → 验证恢复正常

2. **redirect 测试**
   - 点击 "跳转到其他插件" → 验证插件切换

3. **窗口通信测试**  
   - 创建子窗口 → 发送消息 → 验证主窗口接收

---

## 下一步

1. [ ] 确认实现优先级顺序
2. [ ] 开始 Phase 1: SubInput 子输入框实现
3. [ ] 更新 `intools-showcase` 添加验证 UI
4. [ ] 更新 `api-reference.md` 文档
