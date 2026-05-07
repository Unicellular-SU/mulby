# Windows 透明无边框窗口尺寸漂移问题

> 撰写时间：2026-05-07
> 影响平台：Windows（macOS 不受影响）
> 状态：已通过 workaround 修复，记录原生替代方案备用

---

## 1. 问题描述

在 Windows 上，Electron 的透明无边框窗口（`transparent: true` + `frame: false`）在频繁调用 `setPosition()` 移动时，窗口尺寸会持续增大。每次 `setPosition()` 调用都会让窗口宽度或高度增加约 1px，在高频移动场景（如桌面宠物跟随鼠标）下几秒内窗口就会从 80×80 膨胀到数百像素。

### 复现条件

- Windows 10/11，DPI 缩放 ≥ 100%（125%/150% 更明显）
- `BrowserWindow` 配置：`transparent: true`, `frame: false`, `thickFrame: false`
- 高频调用 `win.setPosition(x, y)`（如 60fps 游戏循环）

### 影响范围

- 主窗口及子窗口（auxiliary window）均受影响
- `setSize()` 和 `setBounds(getBounds())` 同样存在漂移问题
- `maxWidth`/`maxHeight` 约束在此场景下被 DWM 忽略

---

## 2. 根本原因

### DWM 坐标转换的舍入误差

Windows Desktop Window Manager (DWM) 在处理无边框窗口时，`setPosition` 内部需要进行 screen coordinates ↔ client coordinates 的转换。当 DPI 缩放不为 100% 时，每次转换都会产生浮点到整数的舍入误差，且该误差是**累积的**。

### Electron/Chromium 层面

Electron 底层调用 Win32 API `SetWindowPos` 时，没有使用 `SWP_NOSIZE` 标志，导致每次设置位置时也隐式地"重新计算"了窗口尺寸，触发 DWM 的舍入误差。

### 相关 Electron Issues

| Issue | 年份 | 状态 | 描述 |
|-------|------|------|------|
| [#48247](https://github.com/electron/electron/issues/48247) | 2024 | Open | `setPosition`/`setBounds` 同步改变窗口宽高 |
| [#27651](https://github.com/electron/electron/issues/27651) | 2021 | Open | `setBounds(getBounds())` 每次调用窗口变大 |
| [#9477](https://github.com/electron/electron/issues/9477) | 2017 | Closed | `setPosition` 在非 100% DPI 下改变窗口尺寸 |
| [#13043](https://github.com/electron/electron/issues/13043) | 2018 | Open | `resizable: false` 时移动窗口导致尺寸变化 |
| [#42178](https://github.com/electron/electron/issues/42178) | 2024 | Open | `setContentBounds` 行为等同 `setBounds`，无法绕过 |

---

## 3. 当前方案：窗口尺寸注册表 + setBounds 固定尺寸

### 原理

维护一个内存注册表（`Map<windowId, {width, height}>`），记录每个窗口的**期望尺寸**。在调用 `setPosition` 时，替换为 `setBounds({ x, y, width: pinned.width, height: pinned.height })`，每次移动都用固定尺寸覆盖，阻止累积漂移。

### 涉及文件

| 文件 | 作用 |
|------|------|
| `src/main/services/window-size-pin.ts` | 尺寸注册表（pin / unpin / update / get） |
| `src/main/plugin/window.ts` | 窗口创建时注册初始尺寸，关闭时注销 |
| `src/main/ipc/window.ts` | `setPosition` IPC 改用 `setBounds` + 注册表尺寸（仅 Windows） |

### 代码逻辑

```
创建窗口 → pinWindowSize(id, width, height)

setPosition IPC (Windows):
  pinned = getPinnedSize(id)
  if pinned → win.setBounds({ x, y, width: pinned.width, height: pinned.height })
  else → win.setPosition(x, y)

setBounds / setSize IPC:
  执行原始操作后 → updatePinnedSize(id, newWidth, newHeight)

关闭窗口 → unpinWindowSize(id)
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 纯 JS 实现，无 native 依赖 | 每次移动都重设尺寸（但性能影响可忽略） |
| 仅在 Windows 上生效 | 需要在所有 resize 入口同步更新注册表 |
| 社区推荐的标准 workaround | 本质是对抗而非解决 DWM 问题 |

---

## 4. 备选方案：Win32 原生 API（SWP_NOSIZE）

### 原理

直接调用 Win32 `SetWindowPos` API，使用 `SWP_NOSIZE` 标志，**从 API 层面告诉 Windows 不要改变窗口尺寸**，彻底绕过 Electron 的坐标转换层。

### 实现方式

通过 Node.js native addon（N-API / node-addon-api）或 `ffi-napi` 调用 `user32.dll` 的 `SetWindowPos`：

```cpp
// native-addon/src/win32_window.cc
#include <napi.h>
#include <windows.h>

Napi::Value SetWindowPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Electron 窗口的 native handle
    // 通过 BrowserWindow.getNativeWindowHandle() 获取
    HWND hwnd = reinterpret_cast<HWND>(
        *reinterpret_cast<int64_t*>(info[0].As<Napi::Buffer<char>>().Data())
    );
    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();

    // SWP_NOSIZE: 忽略 cx/cy 参数，不改变窗口尺寸
    // SWP_NOZORDER: 不改变 Z 顺序
    // SWP_NOACTIVATE: 不激活窗口
    SetWindowPos(hwnd, NULL, x, y, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);

    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setWindowPosition",
                Napi::Function::New(env, SetWindowPosition));
    return exports;
}

NODE_API_MODULE(win32_window, Init)
```

### Electron 侧调用

```typescript
// 仅 Windows
import { getNativeWindowHandle } from './native'

function setPositionNative(win: BrowserWindow, x: number, y: number) {
  const hwnd = win.getNativeWindowHandle()
  nativeAddon.setWindowPosition(hwnd, Math.round(x), Math.round(y))
}
```

### ffi-napi 方案（无需编译 C++）

```typescript
import ffi from 'ffi-napi'
import ref from 'ref-napi'

const user32 = ffi.Library('user32', {
  SetWindowPos: ['bool', ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'uint']]
})

const SWP_NOSIZE = 0x0001
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010

export function setWindowPositionNative(hwndBuffer: Buffer, x: number, y: number) {
  user32.SetWindowPos(
    hwndBuffer,
    ref.NULL_POINTER,
    Math.round(x), Math.round(y),
    0, 0,
    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
  )
}
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 从根源解决，不存在漂移 | 需要 native addon 或 ffi 依赖 |
| 性能更好（单次 API 调用） | 增加构建复杂度（需要 node-gyp / prebuild） |
| 语义精确（SWP_NOSIZE） | 仅适用于 Windows |
| 不需要维护尺寸注册表 | ffi-napi 可能在新 Electron 版本中兼容性不稳 |

---

## 5. 其他已排除方案

| 方案 | 排除原因 |
|------|----------|
| `setContentBounds` 替代 `setBounds` | [#42178](https://github.com/electron/electron/issues/42178) 确认行为相同 |
| `thickFrame: true` | 实测无法阻止漂移 |
| `setPosition` 后 `setSize` 纠正 | `setSize` 自身也会触发 DWM 漂移，纠正无效 |
| `maxWidth` / `maxHeight` 约束 | DWM 在此场景下忽略约束 |
| DPI scaleFactor 手动计算 | 多显示器环境下不可靠，且不解决累积问题 |

---

## 6. 建议

1. **当前阶段**：继续使用「窗口尺寸注册表 + setBounds」方案，稳定可靠
2. **未来优化**：如果项目已有 native addon 基础设施（如 `NativeInputMonitor`），可考虑将 `SetWindowPos(SWP_NOSIZE)` 集成进同一 addon，几乎零额外成本
3. **持续关注**：跟踪 Electron [#27651](https://github.com/electron/electron/issues/27651) 和 [#48247](https://github.com/electron/electron/issues/48247)，若上游修复则可移除 workaround
