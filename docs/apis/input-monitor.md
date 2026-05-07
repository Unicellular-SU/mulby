# 全局输入监听 API (inputMonitor)
本文档描述全局输入监听 API (inputMonitor) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.inputMonitor`
> - 插件后端：`context.api.inputMonitor`

全局输入监听 API 用于实时监听系统级的鼠标和键盘事件（只监听不拦截），适用于录屏工具中的鼠标轨迹标记、键盘输入显示等场景。

**权限要求**:
- 插件 `manifest.json` 中需声明 `"permissions": { "inputMonitor": true }`
- macOS 需要辅助功能权限 (Accessibility)。插件调用 `requireAccessibility()` 或 `start()` 时还需声明 `"permissions": { "accessibility": true }`
- Windows 使用低级钩子，无需额外权限
- Linux 当前仅提供存根实现

缺少 `inputMonitor` 或 `accessibility` 声明时，宿主会拦截调用并抛出对应的 `Plugin "<pluginId>" lacks manifest.permissions.<permission>`。

---

### isAvailable()
[Renderer] [Backend]
检查全局输入监听原生模块是否可用。

```javascript
const available = await inputMonitor.isAvailable();
```

**返回值**: `boolean` — 原生模块是否已加载

### requireAccessibility()
[Renderer] [Backend]
检查并请求辅助功能权限（仅 macOS）。Windows/Linux 直接返回 `true`。

```javascript
const granted = await inputMonitor.requireAccessibility();
if (!granted) {
  console.log('用户未授予辅助功能权限');
}
```

**返回值**: `Promise<boolean>` — 权限是否已授予

### start(options?, callback?)
[Backend]
启动全局输入监听会话。

```javascript
// 监听鼠标和键盘
const sessionId = await api.inputMonitor.start(
  { mouse: true, keyboard: true, throttleMs: 16 },
  (event) => {
    console.log(event.type, event.x, event.y, event.key);
  }
);
```

**参数**:
- `options` (object, 可选):
  - `mouse` (boolean, 默认 `true`) — 是否监听鼠标事件
  - `keyboard` (boolean, 默认 `true`) — 是否监听键盘事件
  - `throttleMs` (number, 默认 `16`) — 鼠标移动事件的节流间隔（毫秒），16ms ≈ 60fps
- `callback` (function, 可选) — 事件回调函数（仅后端 API）

**返回值**: `Promise<string | null>` — 会话 ID，`null` 表示启动失败（权限不足或模块不可用）

### start(options?) [Renderer 版]
[Renderer]
在渲染进程中启动监听。事件通过 `onEvent` 接收。

```javascript
const sessionId = await mulby.inputMonitor.start({ mouse: true, keyboard: true });
```

### stop(sessionId)
[Renderer] [Backend]
停止指定的监听会话。

```javascript
inputMonitor.stop(sessionId);
```

**参数**:
- `sessionId` (string) — `start()` 返回的会话 ID

### onEvent(callback) [Renderer]
[Renderer]
在渲染进程中注册事件监听器。

```javascript
const cleanup = mulby.inputMonitor.onEvent((event) => {
  if (event.type === 'mouseDown') {
    console.log(`点击 (${event.x}, ${event.y}) 按钮=${event.button}`);
  }
  if (event.type === 'keyDown') {
    console.log(`按键 ${event.key}`);
  }
});

// 取消监听
cleanup();
```

**参数**:
- `callback` (function) — 接收 `GlobalInputEvent` 对象

**返回值**: `() => void` — 清理函数，调用后取消监听

### onEvent(sessionId, callback) [Backend]
[Backend]
在后端为指定会话注册/替换事件回调。

```javascript
api.inputMonitor.onEvent(sessionId, (event) => {
  // 处理事件
});
```

---

## GlobalInputEvent 事件对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `string` | 事件类型，见下方事件类型表 |
| `timestamp` | `number` | 事件时间戳 (毫秒) |
| `x` | `number` | 鼠标屏幕 X 坐标（Electron DIP 坐标，可直接与 `screen.getAllDisplays().bounds` / 窗口 bounds 一起使用） |
| `y` | `number` | 鼠标屏幕 Y 坐标（Electron DIP 坐标，可直接与 `screen.getAllDisplays().bounds` / 窗口 bounds 一起使用） |
| `button` | `string?` | 鼠标按键: `'left'`, `'right'`, `'middle'` |
| `clickCount` | `number?` | 点击次数 (1=单击, 2=双击) |
| `scrollDeltaX` | `number?` | 水平滚动量 |
| `scrollDeltaY` | `number?` | 垂直滚动量 |
| `keyCode` | `number?` | 平台原生键码 |
| `key` | `string?` | 可读键名 (如 `'a'`, `'Enter'`, `'Shift'`) |
| `shift` | `boolean` | Shift 键是否按下 |
| `ctrl` | `boolean` | Ctrl 键是否按下 |
| `alt` | `boolean` | Alt/Option 键是否按下 |
| `meta` | `boolean` | Meta/Cmd/Win 键是否按下 |

### 事件类型

| type | 说明 | 附带字段 |
|------|------|---------|
| `mouseMove` | 鼠标移动 | `x`, `y` |
| `mouseDown` | 鼠标按下 | `x`, `y`, `button`, `clickCount` |
| `mouseUp` | 鼠标释放 | `x`, `y`, `button` |
| `mouseScroll` | 鼠标滚轮 | `x`, `y`, `scrollDeltaX`, `scrollDeltaY` |
| `keyDown` | 键盘按下 | `keyCode`, `key` |
| `keyUp` | 键盘释放 | `keyCode`, `key` |

---

## 完整示例：录屏鼠标轨迹标记

```javascript
module.exports = {
  async run(context) {
    const { inputMonitor, screen } = context.api;

    // 检查可用性
    if (!inputMonitor.isAvailable()) {
      context.api.notification.show('全局输入监听不可用');
      return;
    }

    // 收集点击轨迹
    const clicks = [];
    const sessionId = await inputMonitor.start(
      { mouse: true, keyboard: false, throttleMs: 33 },
      (event) => {
        if (event.type === 'mouseDown') {
          clicks.push({
            x: event.x,
            y: event.y,
            button: event.button,
            time: event.timestamp
          });
        }
      }
    );

    // ... 执行录屏逻辑 ...

    // 录屏结束后停止监听
    inputMonitor.stop(sessionId);
    console.log('共记录', clicks.length, '次点击');
  }
};
```

## 完整示例：渲染进程实时键盘显示

```javascript
// 插件 UI 代码 (React)
import { useEffect, useState } from 'react';

function KeystrokeDisplay() {
  const [keys, setKeys] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    let cleanup;

    async function init() {
      const sid = await mulby.inputMonitor.start({ mouse: false, keyboard: true });
      setSessionId(sid);

      cleanup = mulby.inputMonitor.onEvent((event) => {
        if (event.type === 'keyDown' && event.key) {
          setKeys(prev => [...prev.slice(-20), {
            key: event.key,
            mods: [
              event.meta && '⌘',
              event.ctrl && '⌃',
              event.alt && '⌥',
              event.shift && '⇧'
            ].filter(Boolean).join(''),
            time: event.timestamp
          }]);
        }
      });
    }

    init();

    return () => {
      if (sessionId) mulby.inputMonitor.stop(sessionId);
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className="keystroke-overlay">
      {keys.map((k, i) => (
        <span key={i} className="keystroke">
          {k.mods && <span className="mods">{k.mods}</span>}
          {k.key}
        </span>
      ))}
    </div>
  );
}
```

---

## 注意事项

1. **权限声明必须**: 插件 `manifest.json` 必须声明 `"permissions": { "inputMonitor": true }`；macOS 辅助功能授权相关调用还需声明 `"accessibility": true`，否则 API 调用会被宿主拦截。

2. **隐私安全**: 全局键盘监听可捕获密码等敏感输入，插件不应记录或传输键盘内容。Mulby 审核机制会标记使用此权限的插件。

3. **性能**: 鼠标移动事件通过原生层节流（默认 16ms ≈ 60fps），不会淹没 JS 线程。如果不需要高频位置数据，建议设置更大的 `throttleMs`。

4. **自动清理**: 插件退出或窗口关闭时，所有监听会话自动停止，无需手动清理。

5. **平台支持**:
   - macOS: CGEventTap（需辅助功能权限）
   - Windows: SetWindowsHookEx 低级钩子（无需额外权限）
   - Linux: 当前为存根实现，后续将支持 XRecord/XInput2
