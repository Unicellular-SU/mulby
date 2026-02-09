/**
 * React 插件模板 - 后端代码生成器
 * 包含：src/main.ts
 */

/**
 * 生成后端 main.ts 内容
 */
export function buildBackendMain(name: string) {
    return `// PluginContext 类型由 src/ui/types/intools.d.ts 提供
type PluginContext = BackendPluginContext

export function onLoad() {
  console.log('[${name}] 插件已加载')
}

export function onUnload() {
  console.log('[${name}] 插件已卸载')
}

export function onEnable() {
  console.log('[${name}] 插件已启用')
}

export function onDisable() {
  console.log('[${name}] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('插件已启动')
}

// 导出 host 方法供 UI 调用
// 支持三种导出方式（按优先级）：
// 1. 直接导出函数: export async function myMethod(context, ...args) {}
// 2. host 对象（推荐）: export const host = { myMethod(context, ...args) {} }
// 3. 其他对象: export const api = { myMethod(context, ...args) {} }

export const host = {
  // 示例方法：处理数据
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show('处理数据中...')

    // 处理逻辑
    const result = {
      ...data,
      processed: true,
      timestamp: Date.now()
    }

    return result
  },

  // 示例方法：获取配置
  async getConfig(context: PluginContext) {
    // 可以使用 context.api 中的所有 API
    return {
      version: '1.0.0',
      settings: {}
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
`
}
