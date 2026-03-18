# Window Opacity / Transparent API

## 概述

为插件窗口添加透明度控制能力，包含两个不同维度：

| 属性 | Electron API | 说明 |
|------|-------------|------|
| `opacity` | `win.setOpacity(0.8)` | 整个窗口（含内容）变半透明，**运行时可调** |
| `transparent` | `new BrowserWindow({ transparent: true })` | 窗口背景透明，CSS `background: transparent` 的区域会穿透到桌面，**仅创建时生效** |

## 修改的文件

### 1. `src/shared/types/plugin.ts`
- `WindowOptions` 接口新增 `opacity?: number` 和 `transparent?: boolean`

### 2. `src/main/ipc/window.ts`
- 新增 `window:setOpacity` IPC handler（带 0~1 值域校验）
- 新增 `window:getOpacity` IPC handler
- `window:getState` 返回值新增 `opacity` 字段
- `window:child:action` 新增 `setOpacity` action 支持

### 3. `src/main/plugin/window.ts`
- `AuxiliaryWindowOptions` 新增 `opacity` 和 `transparent`
- `createDetachedWindow`：
  - 读取 `manifest.window.transparent` → 影响 BrowserWindow 构造参数
  - 读取 `manifest.window.opacity` → `ready-to-show` 后执行 `win.setOpacity()`
- `createAuxiliaryWindow`：
  - `options.transparent/opacity` 优先于 `manifest.window` 配置
  - 同样的 BrowserWindow 构造和 opacity 设置逻辑

### 4. `src/preload/apis/core-api.ts`
- `window.setOpacity(opacity)` → `Promise<void>`
- `window.getOpacity()` → `Promise<number>`
- `window.create()` options 新增 `opacity` 和 `transparent`
- 子窗口代理新增 `setOpacity()` 方法

### 5. `src/shared/types/electron.d.ts`
- `ElectronAPI.window` 新增 `setOpacity`, `getOpacity`, `getState` 类型
- `PluginInfo.window` 新增 `opacity`, `transparent`

## 插件使用示例

### 渲染进程 API

```typescript
// 设置当前窗口透明度
await window.mulby.window.setOpacity(0.8)

// 获取当前窗口透明度
const opacity = await window.mulby.window.getOpacity()

// 获取窗口状态（包含 opacity）
const state = await window.mulby.window.getState()
// { isMaximized: boolean, isAlwaysOnTop: boolean, opacity: number }
```

### window.create() 创建子窗口

```typescript
const child = await window.mulby.window.create('/widget', {
  width: 300,
  height: 200,
  alwaysOnTop: true,
  opacity: 0.8,        // 初始透明度
  transparent: true,    // 窗口背景透明
})

// 运行时调整子窗口透明度
child.setOpacity(0.5)
```

### Manifest 配置

```json
{
  "window": {
    "width": 800,
    "height": 600,
    "opacity": 0.9,
    "transparent": true
  }
}
```

## 平台支持

- **macOS** ✅ 完全支持 `setOpacity` 和 `transparent`
- **Windows** ✅ 完全支持
- **Linux** ❌ `setOpacity` 不支持（Electron 限制）
