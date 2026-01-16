# InBrowser 可编程自动化浏览器设计方案

## 1. 概述 (Overview)

`inbrowser` 是一个基于 Electron 的可编程自动化浏览器 API，模仿 uTools 的 `ubrowser` 设计。它允许插件通过链式调用的方式，控制一个隐藏或显示的浏览器窗口，执行加载网页、点击元素、输入文本、执行 JS 脚本、截图等一系列操作，并获取执行结果。

## 2. 架构设计 (Architecture)

整体架构采用 **命令队列 (Command Queue)** 模式，分为渲染进程（API 构建者）和主进程（命令执行者）。

### 2.1 渲染进程 (Renderer Process) - `InBrowserBuilder`

*   **职责**: 提供链式调用的 API，不立即执行操作，而是将操作记录到一个队列中。
*   **类名**: `InBrowserBuilder`
*   **核心属性**:
    *   `queue`: `Array<{ op: string, args: any[] }>`  // 存储操作指令
*   **方法**:
    *   `goto(url, headers, timeout)` -> `this` (push op)
    *   `click(selector)` -> `this` (push op)
    *   ... (其他链式方法)
    *   `run(options)` -> `Promise<result>` (发送 IPC 消息)

### 2.2 IPC 通信 Protocol

*   **Channel**: `inbrowser:run`
*   **Payload**:
    ```typescript
    interface InBrowserRunPayload {
      id?: number; // 复用已有窗口 ID（可选）
      options: WindowOptions; // 窗口配置
      queue: Array<{
        type: 'goto' | 'click' | 'evaluate' | ...;
        args: any[];
      }>;
    }
    ```
*   **Response**: `Promise<any[]>` (返回执行结果数组)

### 2.3 主进程 (Main Process) - `InBrowserManager` & `InBrowserWindow`

*   **`InBrowserManager`**:
    *   管理所有的 `InBrowserWindow` 实例。
    *   处理 `inbrowser:run` IPC 请求。
    *   负责窗口资源的回收和复用（`idle` 池）。

*   **`InBrowserWindow`**:
    *   **封装**: 包装一个 `BrowserWindow` 实例。
    *   **执行器 (Executor)**: 包含一个 `async run(queue)` 方法，顺序执行操作队列。
    *   **输入模拟**: 使用 `webContents.sendInputEvent` 模拟物理级键鼠操作。
    *   **脚本注入**: 使用 `webContents.executeJavaScript` 执行页面脚本。

---

## 3. 详细实现方案 (Implementation Details)

### 3.1 核心操作实现

#### A. 导航 (Navigation)
*   **Operation**: `goto(url, headers, timeout)`
*   **Impl**:
    ```typescript
    await win.loadURL(url, { userAgent: ... });
    // 超时处理逻辑
    ```

#### B. 元素交互 (Interaction) - **核心难点**

Electron 的 `sendInputEvent` 是物理级模拟，但需要先获取元素坐标。

1.  **Click (点击)**:
    *   Step 1: 注入 JS (`executeJavaScript`) 获取元素 `selector` 的中心坐标 `(x, y)`。
        *   `document.querySelector(s).getBoundingClientRect()`
    *   Step 2: 抛出错误如果元素不存在或不可见。
    *   Step 3: `win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })`
    *   Step 4: `win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })`

2.  **Type (输入)**:
    *   Step 1: `click` 元素以获取焦点。
    *   Step 2: `win.webContents.sendInputEvent({ type: 'char', keyCode: ... })` 逐字输入。

3.  **Press (按键)**:
    *   直接调用 `sendInputEvent({ type: 'keyDown', keyCode })` 等。

#### C. 脚本执行 (Execution)
*   **Operation**: `evaluate(func, params)`
*   **Impl**:
    *   将 `func` 序列化为字符串：`(${func.toString()})(...JSON.parse('${JSON.stringify(params)}'))`
    *   `const result = await win.webContents.executeJavaScript(code)`
    *   保存 `result` 到结果数组。

#### D. 流程控制
*   **Wait**: `wait(ms)` -> `await new Promise(r => setTimeout(r, ms))`
*   **When**: `when(selector)` -> 轮询检查 DOM 元素是否存在。

### 3.2 窗口管理 (Window Management)

为了性能，应该维护一个**闲置窗口池 (Idle Pool)**。
*   当调用 `run()` 且未指定 ID 时，优先从 Pool 中获取隐藏的窗口。
*   `end()` 操作会将窗口重置（清除 Session/Local Storage 可选）并放回 Pool，或直接销毁。
*   `show: false` 的窗口默认使用 `offscreen` 渲染可能会更高效（视 Electron 版本而定），但为了兼容性通常只是 `show: false`。

### 3.3 安全性 (Security)

*   `nodeIntegration`: **FALSE** (绝对禁止在目标网页开启 Node 能力)
*   `contextIsolation`: **TRUE**
*   `sandbox`: **TRUE**
*   预加载脚本 (Preload): 仅注入必要的 polyfill，不暴露特权 API 给目标网页。

---

## 4. API 定义 (API Signature)

```typescript
// Renderer Side
interface InBrowser {
  // 导航
  goto(url: string, headers?: any, timeout?: number): InBrowser;
  useragent(ua: string): InBrowser;
  viewport(width: number, height: number): InBrowser;

  // 窗口控制
  show(): InBrowser;
  hide(): InBrowser;
  
  // 内容交互
  click(selector: string): InBrowser;
  type(selector: string, text: string): InBrowser;
  press(key: string, modifiers?: string[]): InBrowser;
  value(selector: string, value: string): InBrowser;
  check(selector: string, checked: boolean): InBrowser;
  
  // 数据获取
  evaluate(func: Function, ...args: any[]): InBrowser;
  
  // 流程控制
  wait(ms: number): InBrowser;
  when(selector: string): InBrowser;
  end(): InBrowser;
  
  // 执行
  run(options?: InBrowserOptions): Promise<any[]>;
}
```

## 5. 开发计划 (Phases)

1.  **Phase 1: 基础框架**
    *   实现 IPC 通路。
    *   实现 `goto`, `evaluate`, `run`。
    *   实现简单的窗口创建与销毁。
2.  **Phase 2: 交互增强**
    *   实现 `click` (基于坐标计算)。
    *   实现 `type`/`press` (InputEvent)。
3.  **Phase 3: 高级功能**
    *   `wait`, `when` (DOM 轮询)。
    *   `cookies`, `download`。
4.  **Phase 4: 优化与测试**
    *   窗口复用池。
    *   完善错误处理（超时、元素未找到）。
