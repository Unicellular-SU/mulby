# 插件 Host API (host)
本文档描述 插件 Host API (host) 的使用方法与接口。

> 入口：`window.mulby.host`

Host API 允许插件 UI 调用插件后端（UtilityProcess/Host）中的方法。

## ⚠️ invoke 与 call 的区别

> **这是最常见的混淆点**：`host.invoke` 和 `host.call` 目标完全不同。

| | `host.invoke` | `host.call` |
|---|---|---|
| 调用目标 | Mulby **内置 API**（主进程） | 插件 **自定义方法**（UtilityProcess） |
| method 格式 | `namespace.method`（如 `clipboard.readText`） | 纯方法名（如 `processData`） |
| 使用场景 | 从 UI 直接调用系统 API（不常用） | 从 UI 调用插件后端逻辑（**常用**） |

> **绝大多数情况下你只需要 `host.call`**。`host.invoke` 仅用于从 UI 窗口中直接调用 Mulby 系统 API（如 `clipboard.readText`），通常不需要这样做，因为渲染进程已有 `window.mulby.clipboard` 可用。

## API 方法

### host.invoke(pluginName, method, ...args)
[Renderer]
调用主进程 API 方法（如 clipboard、scheduler 等）。

```javascript
const result = await window.mulby.host.invoke('translator', 'clipboard.readText');
```

**参数**:
- `pluginName` (string) - 插件 ID
- `method` (string) - API 方法路径，格式 `namespace.method`，如 `clipboard.readText`
- `...args` - 传给目标方法的参数

**返回值**: 目标方法的返回值

### host.call(pluginName, method, ...args)
[Renderer]
调用插件后端自定义方法（main.ts 中导出的方法）。

```javascript
const result = await window.mulby.host.call('my-plugin', 'processData', { value: 123 });
```

**参数**:
- `pluginName` (string) - 插件 ID
- `method` (string) - 方法名，如 `processData`
- `...args` - 传给目标方法的参数

**返回值**: `{ data: any }` - 包含方法返回值的对象

### host.status(pluginName)
[Renderer]
获取 Host 状态。

```javascript
const status = await window.mulby.host.status('translator');
// { ready: boolean, active: boolean }
```

### host.restart(pluginName)
[Renderer]
重启插件 Host 进程。

```javascript
const ok = await window.mulby.host.restart('translator');
```

**返回值**: `boolean` - 是否重启成功

## 插件后端方法导出

插件可以通过多种方式导出方法供 UI 调用，系统按以下优先级查找：

### 方式1：直接导出函数（最简单）

```typescript
// main.ts
export async function quickAction(context: PluginContext, text: string) {
  const { notification } = context.api
  notification.show(`处理: ${text}`)
  return { success: true, message: `完成: ${text}` }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'quickAction', 'Hello')
console.log(result.data.message) // "完成: Hello"
```

### 方式2：导出 host 对象（推荐）

```typescript
// main.ts
export const host = {
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show('处理数据中...')
    return { processed: true, result: data }
  },

  async getTasks(context: PluginContext, filter?: any) {
    const { scheduler } = context.api
    return await scheduler.list(filter)
  }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'processData', { value: 123 })
const tasks = await window.mulby.host.call('my-plugin', 'getTasks')
```

### 方式3：导出 api/methods 等对象

```typescript
// main.ts
export const api = {
  async customMethod(context: PluginContext, params: any) {
    const { notification } = context.api
    notification.show(`API调用: ${JSON.stringify(params)}`)
    return { success: true, received: params }
  }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'customMethod', { test: 'data' })
```

## 方法签名规范

所有后端方法的第一个参数必须是 `context`，包含插件 API：

```typescript
async function myMethod(
  context: PluginContext,  // 第一个参数：context
  arg1: string,            // 其他参数
  arg2: number
) {
  const { notification, scheduler, clipboard } = context.api
  // 使用 API
  return { success: true }
}
```

## 查找优先级

系统按以下顺序查找方法：

1. **直接导出的函数** - `export function methodName()`
2. **host 对象** - `export const host = { methodName }`
3. **其他常见对象** - `export const api/methods/exports/handlers = { methodName }`

## 在 React Hook 中使用

使用 `useMulby` hook 可以自动注入 pluginId：

```typescript
import { useMulby } from './hooks/useMulby'

function MyComponent() {
  const { host, notification } = useMulby('my-plugin')

  const handleClick = async () => {
    try {
      // 不需要传 pluginId，hook 会自动注入
      const result = await host.call('processData', { value: 123 })
      notification.show(`成功: ${result.data.message}`)
    } catch (err) {
      notification.show(`失败: ${err.message}`, 'error')
    }
  }

  return <button onClick={handleClick}>处理数据</button>
}
```

## 错误处理

如果方法不存在，系统会返回详细的错误信息：

```
Host method not found: unknownMethod
Available methods: processData, getTasks, quickAction, api.customMethod
Tip: Export methods directly (export function unknownMethod), or in a 'host' object (export const host = { unknownMethod })
```

## 完整示例

```typescript
// main.ts
interface PluginContext {
  api: {
    notification: { show: (msg: string, type?: string) => void }
    scheduler: any
    clipboard: any
  }
}

// 直接导出
export async function quickAction(context: PluginContext, text: string) {
  context.api.notification.show(`快速操作: ${text}`)
  return { success: true }
}

// host 对象（推荐）
export const host = {
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show('处理中...')
    // 处理逻辑
    return { processed: true, result: data }
  },

  async fetchTasks(context: PluginContext, filter?: any) {
    const { scheduler } = context.api
    const tasks = await scheduler.listTasks(filter)
    return tasks
  }
}

export default { run, onLoad, host, quickAction }
```

```typescript
// UI: App.tsx
import { useMulby } from './hooks/useMulby'

export default function App() {
  const { host, notification } = useMulby('my-plugin')

  const handleProcess = async () => {
    try {
      const result = await host.call('processData', { value: 123 })
      console.log(result.data)
      notification.show('处理成功')
    } catch (err) {
      notification.show(`错误: ${err.message}`, 'error')
    }
  }

  const handleQuick = async () => {
    await host.call('quickAction', 'Hello')
  }

  return (
    <div>
      <button onClick={handleProcess}>处理数据</button>
      <button onClick={handleQuick}>快速操作</button>
    </div>
  )
}
```

## 最佳实践

1. **推荐使用 host 对象** - 语义清晰，易于组织多个方法
2. **方法命名** - 使用驼峰命名，避免与生命周期钩子冲突（run, onLoad 等）
3. **返回值** - 返回可序列化的对象（JSON 兼容），避免返回函数、循环引用等
4. **错误处理** - 在方法内部捕获错误，返回明确的错误信息
5. **类型安全** - 使用 TypeScript 定义清晰的参数和返回类型
6. **异步操作** - 所有方法都应该是 async 函数，即使不需要异步操作
7. **后端 API 全部异步** - 在后端 `context.api.*` 中，所有方法调用都经过 IPC 代理，**实际返回 `Promise`**。即使类型签名看起来是同步的，也必须用 `await` 调用