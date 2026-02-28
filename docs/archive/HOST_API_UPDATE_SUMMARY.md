# Host API 更新总结

## 更新日期
2026-01-30

## 更新内容

本次更新实现了插件 UI 调用后端自定义方法的功能，支持三种灵活的导出方式。

## 1. 核心实现

### 1.1 后端支持 (host-worker.ts)
- 实现了 `handleCallHostMethod` 函数
- 支持三种导出方式的自动查找（按优先级）：
  1. 直接导出函数：`export function methodName()`
  2. host 对象：`export const host = { methodName }`
  3. 其他对象：`export const api/methods/exports/handlers = { methodName }`
- 提供详细的错误信息，列出所有可用方法

### 1.2 主进程支持 (host-manager.ts)
- 添加了 `callHostMethod` 方法
- 通过 IPC 向 worker 进程发送 `callHostMethod` 请求

### 1.3 协议定义 (host-protocol.ts)
- 添加了 `'callHostMethod'` 到 `HostRequestType`
- 添加了 `CallHostMethodRequest` 接口

### 1.4 IPC Handler (host.ts)
- 添加了 `host:call` IPC handler
- 处理来自渲染进程的 host 方法调用请求

### 1.5 Preload API (preload/index.ts)
- 在 `window.mulby.host` 中添加了 `call` 方法
- 用于调用插件自定义的 host 方法

## 2. 文档更新

### 2.1 API 文档 (docs/apis/host.md)
- 添加了 `host.call()` API 说明
- 详细说明了三种导出方式
- 提供了完整的使用示例
- 说明了与 `host.invoke()` 的区别

### 2.2 开发指南 (packages/mulby-cli/PLUGIN_DEVELOP_PROMPT.md)
- 添加了第 7 章：Host API - UI 调用后端方法
- 包含三种导出方式的详细说明
- 提供了完整的前后端示例代码
- 说明了方法签名规范和最佳实践

### 2.3 模板更新 (packages/mulby-cli/src/commands/create/templates/react.ts)
- **buildBackendMain**: 添加了 host 对象示例，包含两个示例方法
- **buildUseMulby**: 更新了 host API，添加了 `call` 方法，自动注入 pluginId
- **buildMulbyTypes**: 添加了 `call` 方法的类型定义
- **buildAppTsx**: 添加了调用 host 方法的示例函数和按钮

## 3. 测试验证

### 3.1 测试插件 (scheduler-demo)
创建了完整的测试用例：

**后端 (main.ts)**:
- `directMethod` - 直接导出的函数
- `host.testMethod` - host 对象中的方法
- `api.customMethod` - api 对象中的方法

**前端 (App.tsx)**:
- 三个测试按钮分别调用三种导出方式
- 完整的错误处理
- 显示返回结果

### 3.2 测试结果
✅ 所有三种导出方式都能正常工作
✅ 错误提示清晰明确
✅ 返回值正确序列化

## 4. 使用方式

### 4.1 后端导出（推荐使用 host 对象）

```typescript
// src/main.ts
export const host = {
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show('处理中...')
    return { processed: true, result: data }
  }
}
```

### 4.2 前端调用

```typescript
// src/ui/App.tsx
import { useMulby } from './hooks/useMulby'

export default function App() {
  const { host, notification } = useMulby('my-plugin')

  const handleClick = async () => {
    try {
      const result = await host.call('processData', { value: 123 })
      console.log(result.data)
      notification.show('成功')
    } catch (err) {
      notification.show(`错误: ${err.message}`, 'error')
    }
  }

  return <button onClick={handleClick}>处理数据</button>
}
```

## 5. 查找优先级

系统按以下顺序查找方法：
1. 直接导出的函数
2. host 对象
3. api/methods/exports/handlers 对象

## 6. 与 host.invoke 的区别

- **host.call(method, ...args)** - 调用插件自定义方法（main.ts 中导出的）
- **host.invoke(method, ...args)** - 调用主进程 API（如 clipboard.readText）

## 7. 最佳实践

1. **推荐使用 host 对象** - 语义清晰，易于组织
2. **方法命名** - 使用驼峰命名，避免与生命周期钩子冲突
3. **返回值** - 返回可序列化的对象（JSON 兼容）
4. **错误处理** - 在方法内部捕获错误，返回明确的错误信息
5. **类型安全** - 使用 TypeScript 定义清晰的参数和返回类型
6. **异步操作** - 所有方法都应该是 async 函数

## 8. 文件清单

### 核心实现
- `/Users/su/workspace/mulby/src/main/plugin/host-worker.ts`
- `/Users/su/workspace/mulby/src/main/plugin/host-manager.ts`
- `/Users/su/workspace/mulby/src/main/plugin/host-protocol.ts`
- `/Users/su/workspace/mulby/src/main/ipc/host.ts`
- `/Users/su/workspace/mulby/src/preload/index.ts`

### 文档
- `/Users/su/workspace/mulby/docs/apis/host.md`
- `/Users/su/workspace/mulby/packages/mulby-cli/PLUGIN_DEVELOP_PROMPT.md`

### 模板
- `/Users/su/workspace/mulby/packages/mulby-cli/src/commands/create/templates/react.ts`
- `/Users/su/workspace/mulby/packages/mulby-cli/src/commands/create/templates/basic.ts`

### 测试
- `/Users/su/workspace/mulby/plugins/scheduler-demo/src/main.ts`
- `/Users/su/workspace/mulby/plugins/scheduler-demo/src/ui/App.tsx`
- `/Users/su/workspace/mulby/plugins/scheduler-demo/HOST_METHODS.md`

## 9. 构建状态

✅ 主项目构建成功
✅ scheduler-demo 插件构建成功
✅ 所有测试通过

## 10. 后续工作

- 考虑在其他插件模板（basic.ts）中也添加类似的示例
- 可以考虑添加更多的错误处理和调试信息
- 可以考虑添加性能监控和日志记录
