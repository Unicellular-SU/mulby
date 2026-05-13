# Messaging API (messaging)

插件间通信 API，允许插件之间发送消息和事件。

## 概述

Messaging API 提供了一个基于事件总线的插件间通信机制，支持：

- 点对点消息发送
- 广播消息到所有插件
- 订阅和处理来自其他插件的消息

消息总线只负责实时投递，不持久化未送达消息。插件如果需要在 UI 中展示最近消息，应在自己的后台进程中订阅并缓存消息，再通过 `host.call()` 暴露查询方法。

## 使用场景

- 插件协作：多个插件协同完成任务
- 事件通知：插件向其他插件发送状态变化通知
- 数据共享：插件之间共享数据和状态
- 工作流编排：构建跨插件的工作流

## API 方法

### api.messaging.send()

发送消息到指定插件。

**语法**

```typescript
await api.messaging.send(targetPluginId: string, type: string, payload: unknown): Promise<void>
```

**参数**

- `targetPluginId` (string): 目标插件的 ID
- `type` (string): 消息类型，用于标识消息的用途
- `payload` (unknown): 消息内容，可以是任意可序列化的数据

**返回值**

返回 Promise<void>，消息发送成功后 resolve。

**示例**

```typescript
// 发送文本数据到另一个插件
await api.messaging.send('com.example.translator', 'translate-request', {
  text: 'Hello World',
  from: 'en',
  to: 'zh'
})

// 发送对象数据
await api.messaging.send('com.example.storage', 'save-data', {
  key: 'user-settings',
  value: { theme: 'dark', language: 'zh-CN' }
})
```

**注意事项**

- 目标插件必须已启动并订阅了消息
- 如果目标插件未订阅消息，消息会被丢弃，不会排队等待
- 消息发送是异步的，不保证立即送达
- 目标插件 ID 必须使用 `manifest.id`，未声明 `id` 时才回退到 `manifest.name`

---

### api.messaging.broadcast()

广播消息到所有插件（除了发送者自己）。

**语法**

```typescript
await api.messaging.broadcast(type: string, payload: unknown): Promise<void>
```

**参数**

- `type` (string): 消息类型
- `payload` (unknown): 消息内容

**返回值**

返回 Promise<void>，消息广播成功后 resolve。

**示例**

```typescript
// 广播主题变更事件
await api.messaging.broadcast('theme-changed', {
  theme: 'dark'
})

// 广播数据更新事件
await api.messaging.broadcast('data-updated', {
  collection: 'todos',
  action: 'create',
  id: '123'
})
```

**注意事项**

- 广播消息会发送给所有已订阅的插件（除了发送者）
- 未订阅的插件不会收到消息
- 广播不会发回发送者自己；如果 UI 需要即时反馈，请本地记录一条发送摘要
- 广播是异步的，不保证所有插件同时收到

---

### api.messaging.on()

订阅消息，注册消息处理器。

**语法**

```typescript
api.messaging.on(handler: (message: PluginMessage) => void | Promise<void>): void
```

**参数**

- `handler` (Function): 消息处理函数，接收 PluginMessage 对象

**PluginMessage 对象结构**

```typescript
interface PluginMessage {
  id: string              // 消息 ID
  from: string            // 发送者插件 ID
  to?: string             // 接收者插件 ID（广播消息时为 undefined）
  type: string            // 消息类型
  payload: unknown        // 消息内容
  timestamp: number       // 时间戳（毫秒）
}
```

**示例**

```typescript
// 订阅所有消息
api.messaging.on(async (message) => {
  console.log('收到消息:', message.type, '来自:', message.from)

  // 根据消息类型处理
  if (message.type === 'translate-request') {
    const { text, from, to } = message.payload
    const result = await translate(text, from, to)

    // 回复消息
    await api.messaging.send(message.from, 'translate-response', {
      original: text,
      translated: result
    })
  }
})

// 处理特定类型的消息
api.messaging.on((message) => {
  if (message.type === 'theme-changed') {
    const { theme } = message.payload
    updateTheme(theme)
  }
})
```

**注意事项**

- 可以注册多个处理器，所有处理器都会被调用
- 处理器支持异步函数
- 处理器中的错误会被捕获，不会影响其他处理器
- 在 UtilityProcess 后端中，回调会保存在 worker 内并由主进程转发投递；同一插件重复初始化不会丢失已加载模块中的订阅状态

---

### api.messaging.off()

取消订阅消息。

**语法**

```typescript
api.messaging.off(handler?: (message: PluginMessage) => void | Promise<void>): void
```

**参数**

- `handler` (Function, 可选): 要移除的处理器函数。如果不提供，则移除该插件的所有处理器

**示例**

```typescript
// 定义处理器
const messageHandler = (message) => {
  console.log('收到消息:', message.type)
}

// 订阅
api.messaging.on(messageHandler)

// 取消订阅特定处理器
api.messaging.off(messageHandler)

// 取消订阅所有处理器
api.messaging.off()
```

**注意事项**

- 取消订阅后，该处理器不会再收到新消息
- 如果不提供 handler 参数，会移除该插件的所有消息处理器
- 插件卸载时会自动清理所有订阅
- 传入 `off(handler)` 的必须是当初传给 `on(handler)` 的同一个函数引用

---

## 后台订阅与 UI 查询

需要稳定接收其他插件消息的插件应启用后台运行，并在 `onLoad` 或 `onBackground` 中注册订阅。`background: true` 只表示支持后台运行；是否跟随 Mulby 启动由用户在插件窗口菜单或搜索结果右键菜单中勾选。UI 不直接接收后端消息，而是通过 `host.call()` 调用后端方法读取插件自己维护的缓存。

**manifest.json**

```json
{
  "id": "com.example.messaging-listener",
  "name": "messaging-listener",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "pluginSetting": {
    "background": true,
    "persistent": true,
    "idleTimeoutMs": "never"
  }
}
```

**src/main.ts**

```typescript
let handler: ((message: PluginMessage) => void | Promise<void>) | null = null
const recentMessages: PluginMessage[] = []

function registerMessaging(api: BackendPluginAPI) {
  if (handler) {
    api.messaging.off(handler)
  }

  handler = (message) => {
    recentMessages.unshift(message)
    recentMessages.splice(50)
  }

  api.messaging.on(handler)
}

export function onLoad(context?: BackendPluginContext) {
  if (context) registerMessaging(context.api)
}

export function onBackground(context?: BackendPluginContext) {
  if (context) registerMessaging(context.api)
}

export function onUnload(context?: BackendPluginContext) {
  if (handler && context) {
    context.api.messaging.off(handler)
    handler = null
  }
}

export const rpc = {
  getRecentMessages() {
    return recentMessages
  }
}
```

---

## 完整示例

### 示例 1: 翻译插件协作

**翻译服务插件 (translator-service)**

```typescript
// manifest.json
{
  "id": "com.example.translator-service",
  "name": "translator-service",
  "displayName": "翻译服务",
  "pluginSetting": {
    "background": true  // 支持后台运行；跟随 Mulby 启动由用户勾选
  }
}

// main.js
export async function onBackground({ api }) {
  // 订阅翻译请求
  api.messaging.on(async (message) => {
    if (message.type === 'translate-request') {
      const { text, from, to } = message.payload

      // 调用翻译 API
      const result = await callTranslateAPI(text, from, to)

      // 回复翻译结果
      await api.messaging.send(message.from, 'translate-response', {
        requestId: message.id,
        original: text,
        translated: result,
        from,
        to
      })
    }
  })

  console.log('翻译服务已启动，等待翻译请求...')
}
```

**翻译客户端插件 (translator-client)**

```typescript
export async function run({ api, input }) {
  // 发送翻译请求
  await api.messaging.send('com.example.translator-service', 'translate-request', {
    text: input,
    from: 'en',
    to: 'zh'
  })

  // 订阅翻译结果
  return new Promise((resolve) => {
    const handler = (message) => {
      if (message.type === 'translate-response' &&
          message.from === 'com.example.translator-service') {
        const { translated } = message.payload

        // 显示结果
        api.window.setResult(translated)

        // 取消订阅
        api.messaging.off(handler)
        resolve()
      }
    }

    api.messaging.on(handler)
  })
}
```

### 示例 2: 主题同步

**主题管理插件**

```typescript
export async function run({ api }) {
  // 切换主题
  const newTheme = await api.theme.toggle()

  // 广播主题变更事件
  await api.messaging.broadcast('theme-changed', {
    theme: newTheme,
    timestamp: Date.now()
  })

  api.await notification.show(`主题已切换为 ${newTheme}`)
}
```

**其他插件监听主题变更**

```typescript
export async function onLoad({ api }) {
  // 订阅主题变更事件
  api.messaging.on((message) => {
    if (message.type === 'theme-changed') {
      const { theme } = message.payload
      console.log('主题已变更:', theme)

      // 更新插件 UI
      updatePluginTheme(theme)
    }
  })
}
```

### 示例 3: 数据同步

**数据提供者插件**

```typescript
let dataCache = {}

export async function onBackground({ api }) {
  // 订阅数据请求
  api.messaging.on(async (message) => {
    if (message.type === 'data-get') {
      const { key } = message.payload

      // 返回数据
      await api.messaging.send(message.from, 'data-response', {
        key,
        value: dataCache[key]
      })
    }

    if (message.type === 'data-set') {
      const { key, value } = message.payload
      dataCache[key] = value

      // 广播数据变更
      await api.messaging.broadcast('data-changed', {
        key,
        value
      })
    }
  })
}
```

**数据消费者插件**

```typescript
export async function run({ api }) {
  // 请求数据
  await api.messaging.send('com.example.data-provider', 'data-get', {
    key: 'user-settings'
  })

  // 监听数据响应
  api.messaging.on((message) => {
    if (message.type === 'data-response') {
      const { key, value } = message.payload
      console.log('收到数据:', key, value)
    }

    if (message.type === 'data-changed') {
      const { key, value } = message.payload
      console.log('数据已变更:', key, value)
    }
  })
}
```

---

## 最佳实践

### 1. 消息类型命名

使用清晰的命名约定：

```typescript
// 推荐：使用动词-名词格式
'translate-request'
'translate-response'
'data-get'
'data-set'
'theme-changed'

// 避免：模糊的命名
'message'
'data'
'event'
```

### 2. 错误处理

始终处理消息处理器中的错误：

```typescript
api.messaging.on(async (message) => {
  try {
    // 处理消息
    await processMessage(message)
  } catch (error) {
    console.error('处理消息失败:', error)

    // 可选：发送错误响应
    await api.messaging.send(message.from, 'error', {
      originalMessage: message.id,
      error: error.message
    })
  }
})
```

### 3. 请求-响应模式

使用消息 ID 关联请求和响应：

```typescript
// 发送请求
const requestId = Date.now().toString()
await api.messaging.send('target-plugin', 'request', {
  requestId,
  data: 'some data'
})

// 处理响应
api.messaging.on((message) => {
  if (message.type === 'response' &&
      message.payload.requestId === requestId) {
    // 处理响应
  }
})
```

### 4. 清理订阅

在插件卸载时清理订阅：

```typescript
let messageHandler

export async function onLoad({ api }) {
  messageHandler = (message) => {
    // 处理消息
  }
  api.messaging.on(messageHandler)
}

export async function onUnload({ api }) {
  // 清理订阅
  api.messaging.off(messageHandler)
}
```

### 5. 超时处理

为请求-响应模式添加超时：

```typescript
async function sendWithTimeout(api, targetId, type, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      api.messaging.off(handler)
      reject(new Error('请求超时'))
    }, timeout)

    const handler = (message) => {
      if (message.type === 'response' && message.from === targetId) {
        clearTimeout(timer)
        api.messaging.off(handler)
        resolve(message.payload)
      }
    }

    api.messaging.on(handler)
    api.messaging.send(targetId, type, payload)
  })
}
```

---

## 注意事项

1. **消息不保证送达**：如果目标插件未运行或未订阅，消息会被丢弃
2. **消息顺序**：不保证消息按发送顺序到达
3. **性能考虑**：避免发送大量或频繁的消息，可能影响性能
4. **安全性**：不要通过消息传递敏感信息，消息可能被其他插件拦截
5. **内存管理**：及时取消不需要的订阅，避免内存泄漏
6. **循环依赖**：避免插件之间形成消息循环，可能导致无限递归

---

## 相关 API

- [插件管理 API (plugin)](./plugin.md) - 插件生命周期管理
- [存储 API (storage)](./storage.md) - 插件数据存储
- [通知 API (notification)](./notification.md) - 用户通知
