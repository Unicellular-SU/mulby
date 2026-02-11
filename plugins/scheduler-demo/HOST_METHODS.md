# Host 方法调用说明

## 概述

插件的 UI 可以通过 `window.mulby.host.call()` 调用后端（main.ts）中导出的方法。系统支持三种导出方式，按优先级查找。

## 支持的导出方式

### 方式1：直接导出函数（最简单）

```typescript
// main.ts
export async function directMethod(context: PluginContext, message: string) {
  const { notification } = context.api
  notification.show(`收到消息: ${message}`)

  return {
    success: true,
    message: `处理完成: ${message}`
  }
}
```

**UI 调用：**
```typescript
const result = await host.call('directMethod', '测试消息')
console.log(result.data.message)
```

### 方式2：导出 host 对象（推荐）

```typescript
// main.ts
export const host = {
  async testMethod(context: PluginContext, message: string) {
    const { notification } = context.api
    notification.show(`Host方法: ${message}`)

    return {
      success: true,
      message: `Hello from host: ${message}`
    }
  },

  async getTasks(context: PluginContext) {
    const { scheduler } = context.api
    return await scheduler.list()
  }
}
```

**UI 调用：**
```typescript
const result = await host.call('testMethod', '测试消息')
const tasks = await host.call('getTasks')
```

### 方式3：导出 api/methods 等对象

```typescript
// main.ts
export const api = {
  async customMethod(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show(`API方法: ${JSON.stringify(data)}`)

    return {
      success: true,
      received: data
    }
  }
}
```

**UI 调用：**
```typescript
const result = await host.call('customMethod', { test: 'data' })
```

## 查找优先级

系统按以下顺序查找方法：

1. **直接导出的函数** - `export function methodName()`
2. **host 对象** - `export const host = { methodName }`
3. **其他常见对象** - `export const api/methods/exports/handlers = { methodName }`

## 方法签名

所有 host 方法的第一个参数必须是 `context`，包含插件 API：

```typescript
async function myMethod(
  context: PluginContext,  // 第一个参数：context
  arg1: string,            // 其他参数
  arg2: number
) {
  const { notification, scheduler, clipboard } = context.api
  // 使用 API
}
```

## UI 中使用

```typescript
import { useMulby } from './hooks/useMulby'

function MyComponent() {
  const { host, notification } = useMulby('my-plugin')

  const handleClick = async () => {
    try {
      const result = await host.call('myMethod', 'arg1', 123)
      notification.show(`成功: ${result.data.message}`)
    } catch (err) {
      notification.show(`失败: ${err.message}`, 'error')
    }
  }

  return <button onClick={handleClick}>调用后端方法</button>
}
```

## 错误处理

如果方法不存在，系统会返回详细的错误信息，包括：
- 请求的方法名
- 所有可用的方法列表
- 使用提示

```
Host method not found: unknownMethod
Available methods: testMethod, getTasks, directMethod, api.customMethod
Tip: Export methods directly (export function unknownMethod), or in a 'host' object (export const host = { unknownMethod })
```

## 最佳实践

1. **推荐使用 host 对象** - 语义清晰，易于组织
2. **方法命名** - 使用驼峰命名，避免与生命周期钩子冲突（run, onLoad 等）
3. **返回值** - 返回可序列化的对象（JSON 兼容）
4. **错误处理** - 在方法内部捕获错误，返回明确的错误信息
5. **类型安全** - 使用 TypeScript 定义清晰的参数和返回类型

## 示例：完整的插件

```typescript
// main.ts
interface PluginContext {
  api: {
    notification: { show: (msg: string) => void }
    scheduler: any
    // ... 其他 API
  }
}

// 方式1：直接导出
export async function quickAction(context: PluginContext, text: string) {
  context.api.notification.show(`快速操作: ${text}`)
  return { success: true }
}

// 方式2：host 对象（推荐）
export const host = {
  async processData(context: PluginContext, data: any) {
    // 处理数据
    return { processed: true, result: data }
  },

  async fetchTasks(context: PluginContext, filter?: any) {
    const tasks = await context.api.scheduler.list(filter)
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
    const result = await host.call('processData', { value: 123 })
    console.log(result.data)
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
