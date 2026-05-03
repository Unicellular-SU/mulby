# 插件 Host API (host)
本文档描述 插件 Host API (host) 的使用方法与接口。

> 入口：`window.mulby.host`

Host API 允许插件 UI 调用插件后端（UtilityProcess/Host）中的方法。

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

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否重启成功

## 插件后端方法导出

插件可以通过多种方式导出方法供 UI 调用，系统按以下优先级查找：

### 方式1：导出 rpc 对象（新版核心推荐🌟）

这是 Mulby 最新的标准化推荐写法。**不会有任何隐式参数偏移**，前端传什么参数，后端就接收什么参数。底层 API 可通过注入的全局对象 `mulby` 直接访问。

```typescript
// main.ts
export const rpc = {
  async processData(data: any) {
    // 随时随地调用底层 API，无需从参数中提取
    await mulby.notification.show('处理数据中...')
    return { processed: true, result: data }
  },

  async getTasks(filter?: any) {
    return await mulby.scheduler.list(filter)
  }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'processData', { value: 123 })
const tasks = await window.mulby.host.call('my-plugin', 'getTasks', { status: 'active' })
```

### 方式2：直接导出函数（兼容旧规范）

```typescript
// main.ts
export async function quickAction(context: PluginContext, text: string) {
  const { notification } = context.api
  await notification.show(`处理: ${text}`)
  return { success: true, message: `完成: ${text}` }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'quickAction', 'Hello')
console.log(result.data.message) // "完成: Hello"
```

### 方式3：导出 host 对象（兼容旧规范）

```typescript
// main.ts
export const host = {
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    await notification.show('处理数据中...')
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
    await notification.show(`API调用: ${JSON.stringify(params)}`)
    return { success: true, received: params }
  }
}
```

**UI 调用：**
```typescript
const result = await window.mulby.host.call('my-plugin', 'customMethod', { test: 'data' })
```

## 方法签名规范与“参数偏移”说明

Mulby 提供了两套方法映射标准：

### 1. 新规范：`rpc` 命名空间（首选）
凡是在 `export const rpc` 命名空间下的方法，**不会**发生任何隐式参数偏移。前端传入的参数将 1:1 的精准映射到后端的函数入参中。

```typescript
// 前端：host.call('my-plugin', 'submitData', { id: 1 }, true)
// 后端：
export const rpc = {
  async submitData(data: { id: number }, force: boolean) {
     // 直接使用全局上下文 mulby 即可
     mulby.await notification.show('收到请求');
  }
}
```

### 2. 旧规范：`host` 或顶层导出（存在首参偏移）
>为了保障旧版本社区插件不崩溃，Mulby 维持了这一陈旧规范。

如果你的方法放在 `export const host` 下或采用顶层导出，系统会强行将 `context: PluginContext` 对象注入为**函数的第一个入参**，你在前端传入的实质 `payload` 等参数会被向后挤压偏移一位。常常导致开发者感到“找不齐参数”。

```typescript
// 前端：host.call('my-plugin', 'submitData', { id: 1 }, true)
// 后端错误接收示范：
export const host = {
  // 此时参数被挤压，第一个参数其实是 context 对象，而不是 { id: 1 }！
  async submitData(context: PluginContext, data: { id: number }, force: boolean) {
     context.api.await notification.show('依赖首参数提取 API');
  }
}
```

## 模块查找优先级与解析保护

如果遇到方法未被注册的情况，请优先检查是否因为使用了 `export default` 导致被 ESM 默认覆盖。不过 Mulby 底层最新架构已经做了解析融合保障，只要写出了对应的名字都能被系统安全识别。其动态搜寻优先级如下：

1. **rpc 对象** - `export const rpc = { methodName }` （精准签名）
2. **host 对象** - `export const host = { methodName }` （隐式注入签名）
3. **直接导出的函数** - `export function methodName()` （隐式注入签名）
4. **其他常见对象** - `export const api/methods/exports/handlers = { methodName }` （隐式注入签名）

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
      await notification.show(`成功: ${result.data.message}`)
    } catch (err) {
      await notification.show(`失败: ${err.message}`, 'error')
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

最佳实践样例，采用最新的 `rpc` 对象并利用全局 `mulby`：

```typescript
// main.ts
// 使用全局 mulby 声明或自行类型推断

export const rpc = {
  async processData(data: any) {
    await mulby.notification.show('处理中...')
    // 直接处理精确映射入参
    return { processed: true, result: data }
  },

  async fetchTasks(filter?: any) {
    const tasks = await mulby.scheduler.list(filter)
    return tasks
  },

  async quickAction(text: string) {
    await mulby.notification.show(`快速操作: ${text}`)
    return { success: true }
  }
}

// 就算你提供 export default，最新的系统仍能够抓取出你的 rpc 挂载点
export default { run, onLoad }
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
      await notification.show('处理成功')
    } catch (err) {
      await notification.show(`错误: ${err.message}`, 'error')
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

1. **🌟推荐使用 rpc 对象** - 可以获得 1:1 纯净的参数透传体验，不受系统隐式干预。
2. **方法命名** - 使用驼峰命名，避免与生命周期钩子冲突（run, onLoad 等）。
3. **返回值** - 请返回可序列化的对象（JSON 兼容），切勿返回函数、Proxy 或 DOM 实体，否则导致 IPC 序列化崩溃。
4. **错误处理** - 在方法内部主动使用 try...catch，向前端返回明确的操作状态。
5. **全局 API 防御** - 请注意，`globalThis.mulby` 会在所有 `rpc` 方法中直接可用，如果开发环境 Typescript 报警不存在，可在顶部增加 `declare const mulby: any` 以暂时规避类型检查。