# 主题 API (theme)
本文档描述 主题 API (theme) 的使用方法与接口。

> 入口：`window.mulby.theme`

主题 API 允许插件获取和跟随主程序的主题设置，实现视觉一致性。

### get()
[Renderer]
获取当前主题信息。

```javascript
const themeInfo = await window.mulby.theme.get();
// 返回: { mode: 'system', actual: 'dark' }
```

**返回值**: `ThemeInfo`

```typescript
interface ThemeInfo {
  mode: 'light' | 'dark' | 'system';  // 用户设置的主题模式
  actual: 'light' | 'dark';            // 实际应用的主题
}
```

### set(mode)
[Renderer]
设置主题模式。

```javascript
await window.mulby.theme.set('dark');   // 设置为暗色主题
await window.mulby.theme.set('light');  // 设置为亮色主题
await window.mulby.theme.set('system'); // 跟随系统主题
```

**参数**:
- `mode` ('light' | 'dark' | 'system') - 主题模式

**返回值**: `ThemeInfo` - 更新后的主题信息

### getActual()
[Renderer]
获取实际应用的主题（解析 system 后的结果）。

```javascript
const theme = await window.mulby.theme.getActual();
// 返回: 'light' 或 'dark'
```

**返回值**: `'light' | 'dark'`

### onThemeChange(callback)
[Renderer]
监听主题变化事件。

```javascript
window.mulby.onThemeChange((theme) => {
  console.log('主题已变更为:', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
});
```

**参数**:
- `callback` ((theme: 'light' | 'dark') => void) - 主题变化回调函数

### 插件中使用主题

#### 获取初始主题

插件 UI 加载时，可通过 URL 参数获取当前主题（仅附着模式）：

```javascript
function getInitialTheme() {
  const params = new URLSearchParams(window.location.search);
  return params.get('theme') || 'light';
}
```

#### 监听主题变化（推荐）

使用 `window.mulby.onThemeChange` 监听主题变化，适用于附着模式和独立窗口模式：

```javascript
window.mulby?.onThemeChange?.((theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
});
```

### 完整示例

#### 插件 CSS（使用 CSS 变量支持主题）

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border: #d1d5db;
  --accent: #3B82F6;
}

.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d2d;
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --border: #3d3d3d;
  --accent: #3B82F6;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
```

#### 插件 React 组件

```tsx
import { useState, useEffect } from 'react';

function getInitialTheme(): 'light' | 'dark' {
  const params = new URLSearchParams(window.location.search);
  return (params.get('theme') as 'light' | 'dark') || 'light';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 监听主题变化
  useEffect(() => {
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme);
    });
  }, []);

  return (
    <div className="app">
      <p>当前主题: {theme}</p>
    </div>
  );
}
```