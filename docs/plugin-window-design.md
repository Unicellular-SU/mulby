# InTools 插件窗口设计方案

## 概述

插件 UI 支持两种运行模式：**附着模式**和**独立模式**。

## 一、交互模式

### 1.1 附着模式（Attached）

- 插件 UI 显示在搜索框下方
- 跟随主窗口移动
- 切换插件或按 ESC 时关闭
- 不显示在任务栏

### 1.2 独立模式（Detached）

- 插件 UI 在独立窗口中运行
- 可自由移动、调整大小
- 支持关闭、最小化、置顶
- 显示在任务栏
- 可同时打开多个独立插件窗口

## 二、用户交互

### 2.1 窗口布局

```
附着模式：
┌─────────────────────────────────────────┐
│  🔍 搜索框                              │
├─────────────────────────────────────────┤
│  [📌 独立]        插件名称              │  ← 插件标题栏
├─────────────────────────────────────────┤
│                                         │
│              插件 UI 内容               │  ← 附着区域
│                                         │
└─────────────────────────────────────────┘

独立模式：
┌─────────────────────────────────────────┐
│  [−] [□] [×]     插件名称               │  ← 系统标题栏
├─────────────────────────────────────────┤
│                                         │
│              插件 UI 内容               │
│                                         │
└─────────────────────────────────────────┘
```

### 2.2 分离触发方式

| 方式 | 操作 | 说明 |
|------|------|------|
| 按钮 | 点击 `[📌 独立]` | 最直观 |
| 快捷键 | `Cmd/Ctrl + D` | 高效用户 |
| 双击 | 双击插件标题栏 | 符合直觉 |

### 2.3 多窗口支持

- 独立模式下可同时打开多个不同插件
- 同一插件也可打开多个实例
- 每个窗口独立管理生命周期

## 三、技术架构

### 3.1 窗口结构

```
MainWindow (BrowserWindow, frameless)
├─ SearchInput (React 组件)
└─ PluginContainer (webview 或 iframe)
    └─ 加载插件 UI (附着模式)

DetachedWindow (BrowserWindow, 有标题栏)
└─ 加载插件 UI (独立模式)
```

### 3.2 核心类

```typescript
// 插件窗口管理器
class PluginWindowManager {
  // 附着的插件
  private attachedPlugin: AttachedPlugin | null

  // 独立窗口 Map<windowId, DetachedWindow>
  private detachedWindows: Map<number, DetachedWindow>

  // 附着插件
  attachPlugin(plugin: Plugin, featureCode: string, input?: string): void

  // 分离为独立窗口
  detachCurrent(): BrowserWindow | null

  // 创建独立窗口
  createDetachedWindow(plugin: Plugin, featureCode: string, input?: string): BrowserWindow

  // 关闭附着插件
  closeAttached(): void

  // 关闭指定独立窗口
  closeDetached(windowId: number): void

  // 关闭所有
  closeAll(): void
}
```

### 3.3 状态管理

```typescript
interface PluginWindowState {
  pluginId: string
  featureCode: string
  mode: 'attached' | 'detached'

  // 附着模式
  attachedHeight?: number

  // 独立模式
  windowId?: number
  bounds?: { x: number; y: number; width: number; height: number }
  alwaysOnTop?: boolean

  // 插件数据
  input?: string
}
```

## 四、API 设计

### 4.1 插件 UI 可用 API

```typescript
interface IntoolsWindowAPI {
  // 设置附着区域高度
  setHeight(height: number): void

  // 分离为独立窗口
  detach(): void

  // 窗口置顶（独立模式）
  setAlwaysOnTop(flag: boolean): void

  // 获取当前模式
  getMode(): Promise<'attached' | 'detached'>

  // 隐藏主窗口
  hide(): void

  // 关闭当前插件窗口
  close(): void
}

// 使用示例
window.intools.window.setHeight(400)
window.intools.window.detach()
```

### 4.2 IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `plugin:setHeight` | Renderer → Main | 设置附着高度 |
| `plugin:detach` | Renderer → Main | 分离窗口 |
| `plugin:close` | Renderer → Main | 关闭插件 |
| `plugin:init` | Main → Renderer | 初始化数据 |
| `plugin:modeChanged` | Main → Renderer | 模式变更通知 |

## 五、生命周期

```
用户搜索插件
      │
      ▼
┌─────────────┐
│  加载插件   │ ──→ 发送 plugin:init 事件
│  (附着模式) │
└─────────────┘
      │
      ├──── 用户切换插件 ──→ 关闭当前，加载新插件
      │
      ├──── 用户按 ESC ──→ 关闭插件，隐藏主窗口
      │
      └──── 用户点击独立 ──→ 分离为独立窗口
                              │
                              ▼
                        ┌─────────────┐
                        │  独立窗口   │
                        │  (可多个)   │
                        └─────────────┘
                              │
                              └──── 用户关闭窗口 ──→ 销毁窗口
```

## 六、实现要点

### 6.1 附着模式

1. 主窗口使用 `webview` 标签加载插件 UI
2. 插件调用 `setHeight()` 动态调整主窗口高度
3. 主窗口移动时，附着区域自动跟随（同一窗口）

### 6.2 独立模式

1. 创建新的 `BrowserWindow`
2. 加载相同的插件 UI
3. 传递当前状态（input、已有数据）
4. 记住窗口位置，下次打开时恢复

### 6.3 多窗口管理

1. 使用 `Map<windowId, WindowInfo>` 管理所有独立窗口
2. 每个窗口有唯一 ID
3. 窗口关闭时从 Map 中移除

## 七、文件结构

```
src/main/
├── window/
│   ├── mainWindow.ts        # 主窗口管理
│   └── pluginWindow.ts      # 插件窗口管理器
├── plugin/
│   ├── manager.ts           # 插件管理（已有）
│   └── ...
└── ipc/
    └── pluginWindow.ts      # 插件窗口 IPC 处理

src/renderer/
├── components/
│   ├── SearchInput.tsx      # 搜索框（已有）
│   ├── PluginList.tsx       # 插件列表（已有）
│   └── PluginContainer.tsx  # 插件容器（新增）
└── ...

src/preload/
├── index.ts                 # 主窗口 preload
└── plugin.ts                # 插件窗口 preload
```
