# 插件 Tools API (tools)
本文档描述插件如何通过 Tools API 向 AI Agent 提供可调用的工具。

> 入口（后端）：`context.api.tools`

Plugin Tools 允许插件声明可被 AI Agent 自动发现和调用的函数（tools）。
本质上，插件可以像一个 MCP Server 一样，为 AI 提供工具能力，但通过 Mulby 插件体系管理。

## 概述

- 插件在 `manifest.json` 中**静态声明** tool 的 schema（名称、描述、参数），让 AI 能够发现它们
- 插件在 `main.ts` 的 `onLoad` 中**动态注册** handler，让主进程在 AI 调用时能够执行
- 工具优先级：内建工具 > MCP 工具 > Plugin Tools（同名时高优先级覆盖低优先级）

## Manifest 声明

在 `manifest.json` 中添加顶层 `tools` 字段：

```json
{
  "name": "translator",
  "tools": [
    {
      "name": "translate",
      "description": "翻译文本到目标语言",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "description": "要翻译的文本" },
          "targetLang": { "type": "string", "description": "目标语言代码，如 'en', 'zh', 'ja'" }
        },
        "required": ["text", "targetLang"]
      }
    }
  ]
}
```

### Tool Schema 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 工具名称，仅允许 `[a-zA-Z0-9_-]` |
| `description` | string | ✅ | 工具描述，AI 用它来理解何时调用 |
| `inputSchema` | object | ✅ | JSON Schema，`type` 必须为 `"object"` |
| `inputSchema.properties` | object | ✅ | 参数定义 |
| `inputSchema.required` | string[] | ❌ | 必填参数列表 |

> **纯工具插件**：允许插件只有 `tools` 而没有 `features`，此时插件仅作为 AI 工具提供者存在。

## API 方法

### tools.register(name, handler)
[Backend]
注册工具的执行处理函数。在 `onLoad` 中调用。

```typescript
// main.ts
export function onLoad() {
  const { tools } = context.api

  tools.register('translate', async (args) => {
    const { text, targetLang } = args as { text: string; targetLang: string }
    const translated = await doTranslation(text, targetLang)
    return { translatedText: translated }
  })
}
```

**参数**:
- `name` (string) - 工具名称，必须与 manifest.tools 中声明的 name 一致
- `handler` (function) - 处理函数，接收 AI 传入的参数对象，返回结果

**注意**:
- handler 的返回值必须是可序列化的对象（JSON 兼容）
- handler 内部可以使用 `context.api` 访问所有插件 API
- 如果 manifest 声明了 tool 但未注册 handler，AI 调用时会报错

### tools.unregister(name)
[Backend]
注销已注册的工具处理函数。

```typescript
tools.unregister('translate')
```

**参数**:
- `name` (string) - 要注销的工具名称

## 工具 ID 格式

AI 看到的工具名称格式为 `plugin_tool__{sanitizedPluginId}__{toolName}`，与 MCP 工具的 `mcp__{serverId}__{toolName}` 风格一致。

> `pluginId` 中的特殊字符（如 `@`, `/`, `.`）会被自动规范化为下划线。

## 完整示例

```json
// manifest.json
{
  "name": "weather-tool",
  "displayName": "天气查询工具",
  "version": "1.0.0",
  "main": "dist/main.js",
  "icon": "icon.png",
  "tools": [
    {
      "name": "get_weather",
      "description": "获取指定城市的当前天气信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "城市名称" },
          "unit": { "type": "string", "enum": ["celsius", "fahrenheit"], "description": "温度单位" }
        },
        "required": ["city"]
      }
    },
    {
      "name": "get_forecast",
      "description": "获取未来几天的天气预报",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "城市名称" },
          "days": { "type": "number", "description": "预报天数（1-7）" }
        },
        "required": ["city"]
      }
    }
  ]
}
```

```typescript
// main.ts
/// <reference path="./types/mulby.d.ts" />
type PluginContext = BackendPluginContext

export function onLoad() {
  const { tools, http } = (globalThis as any).__mulby_context__.api

  tools.register('get_weather', async (args: any) => {
    const { city, unit = 'celsius' } = args
    const resp = await http.get(`https://api.weather.example.com/current?city=${city}&unit=${unit}`)
    return JSON.parse(resp.data)
  })

  tools.register('get_forecast', async (args: any) => {
    const { city, days = 3 } = args
    const resp = await http.get(`https://api.weather.example.com/forecast?city=${city}&days=${days}`)
    return JSON.parse(resp.data)
  })
}

export function onUnload() {
  // tools 会在插件卸载时自动清理，通常无需手动 unregister
}

export default { onLoad, onUnload }
```

## 最佳实践

1. **描述清晰** - `description` 应明确说明工具的功能和使用场景，AI 依赖它来决定何时调用
2. **参数详尽** - `inputSchema` 中每个 property 都应有 `description`，帮助 AI 正确传参
3. **返回可序列化** - handler 返回值必须是 JSON 兼容的对象
4. **错误处理** - 在 handler 中妥善处理异常，返回有意义的错误信息
5. **按需注册** - 在 `onLoad` 中注册，在 `onUnload` 时可选择手动注销（系统会自动清理）
6. **命名规范** - 工具名称使用 snake_case（如 `get_weather`），保持与 AI 工具生态一致
