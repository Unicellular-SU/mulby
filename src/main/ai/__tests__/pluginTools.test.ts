import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  PluginToolRegistry,
  buildPluginToolId,
  isPluginToolName,
  parsePluginToolId,
  sanitizePluginIdForToolName
} from '../../plugin/plugin-tools'
import type { PluginToolSchema } from '../../../shared/types/plugin'

describe('sanitizePluginIdForToolName', () => {
  it('应处理 @scope/name 格式', () => {
    assert.equal(sanitizePluginIdForToolName('@scope/name'), 'scope_name')
  })

  it('应处理 com.example.name 格式', () => {
    assert.equal(sanitizePluginIdForToolName('com.example.name'), 'com_example_name')
  })

  it('应处理带空格的名称', () => {
    assert.equal(sanitizePluginIdForToolName('my plugin'), 'my_plugin')
  })

  it('应保留简单合法名称不变', () => {
    assert.equal(sanitizePluginIdForToolName('my-plugin'), 'my-plugin')
    assert.equal(sanitizePluginIdForToolName('simple_name'), 'simple_name')
  })

  it('空字符串应回退为 plugin', () => {
    assert.equal(sanitizePluginIdForToolName(''), 'plugin')
  })

  it('应截断超长名称', () => {
    const longName = 'a'.repeat(100)
    // 验证 buildPluginToolId 生成的完整 ID 不超限
    const toolId = buildPluginToolId(longName, 'test')
    assert.ok(toolId.length <= 64, `Generated tool ID too long: ${toolId.length} chars`)
  })
})

describe('buildPluginToolId', () => {
  it('应正确生成 plugin tool ID（简单名称）', () => {
    assert.equal(buildPluginToolId('my-plugin', 'search'), 'plugin_tool__my-plugin__search')
  })

  it('应规范化含特殊字符的 pluginId', () => {
    // @scope/name → scope_name
    assert.equal(buildPluginToolId('@scope/name', 'run_query'), 'plugin_tool__scope_name__run_query')
  })

  it('生成的 tool ID 不应超过 64 字符', () => {
    const result = buildPluginToolId('very-long-plugin-name-that-exceeds-limits', 'also_long_tool_name')
    assert.ok(result.length <= 64, `Tool ID too long: ${result.length} chars: ${result}`)
  })
})

describe('isPluginToolName', () => {
  it('应识别 plugin tool 名称', () => {
    assert.equal(isPluginToolName('plugin_tool__my-plugin__search'), true)
    assert.equal(isPluginToolName('plugin_tool__x__y'), true)
  })

  it('不应误判非 plugin tool 名称', () => {
    assert.equal(isPluginToolName('mcp__server__tool'), false)
    assert.equal(isPluginToolName('mulby_read_file'), false)
    assert.equal(isPluginToolName(''), false)
  })
})

describe('parsePluginToolId', () => {
  it('应正确解析 plugin tool ID', () => {
    const result = parsePluginToolId('plugin_tool__my-plugin__search')
    assert.equal(result.pluginId, 'my-plugin')
    assert.equal(result.toolName, 'search')
  })

  it('应解析规范化后的 pluginId', () => {
    // buildPluginToolId('@scope/name', ...) 生成 plugin_tool__scope_name__...
    const toolId = buildPluginToolId('@scope/name', 'run_query')
    const result = parsePluginToolId(toolId)
    assert.equal(result.pluginId, 'scope_name')  // 规范化后的 ID
    assert.equal(result.toolName, 'run_query')
  })

  it('应拒绝无效的 tool ID', () => {
    assert.throws(() => parsePluginToolId('invalid'))
    assert.throws(() => parsePluginToolId('mcp__server__tool'))
  })
})

describe('PluginToolRegistry', () => {
  let registry: PluginToolRegistry

  beforeEach(() => {
    registry = new PluginToolRegistry()
  })

  const createTool = (name: string, description = 'test tool'): PluginToolSchema => ({
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    }
  })

  describe('refreshPlugin', () => {
    it('应正确注册插件工具', () => {
      const tools = [createTool('search'), createTool('translate')]
      registry.refreshPlugin('test-plugin', 'Test Plugin', tools)

      assert.equal(registry.getToolCount(), 2)
      assert.equal(registry.getPluginTools('test-plugin').length, 2)
    })

    it('应跳过无效的 tool 声明', () => {
      const tools = [
        createTool(''),            // 空名称
        createTool('search'),      // 有效
        { name: 'bad', description: '', inputSchema: { type: 'object' as const, properties: {} } }  // 空描述
      ]
      registry.refreshPlugin('test-plugin', 'Test Plugin', tools)

      // 只有 search 是有效的
      assert.equal(registry.getToolCount(), 1)
    })

    it('应跳过重复声明的 tool', () => {
      const tools = [createTool('search'), createTool('search')]
      registry.refreshPlugin('test-plugin', 'Test Plugin', tools)

      assert.equal(registry.getToolCount(), 1)
    })

    it('空 tools 数组应清除注册', () => {
      registry.refreshPlugin('test-plugin', 'Test Plugin', [createTool('search')])
      assert.equal(registry.getToolCount(), 1)

      registry.refreshPlugin('test-plugin', 'Test Plugin', [])
      assert.equal(registry.getToolCount(), 0)
    })

    it('刷新时应替换旧的 tools', () => {
      registry.refreshPlugin('test-plugin', 'Test Plugin', [createTool('search')])
      registry.refreshPlugin('test-plugin', 'Test Plugin', [createTool('translate')])

      assert.equal(registry.getToolCount(), 1)
      const tools = registry.getPluginTools('test-plugin')
      assert.equal(tools[0].schema.name, 'translate')
    })
  })

  describe('removePlugin', () => {
    it('应移除插件的所有工具', () => {
      registry.refreshPlugin('plugin-a', 'Plugin A', [createTool('tool1')])
      registry.refreshPlugin('plugin-b', 'Plugin B', [createTool('tool2')])

      registry.removePlugin('plugin-a')

      assert.equal(registry.getToolCount(), 1)
      assert.equal(registry.getPluginTools('plugin-a').length, 0)
      assert.equal(registry.getPluginTools('plugin-b').length, 1)
    })

    it('移除不存在的插件不应报错', () => {
      assert.doesNotThrow(() => registry.removePlugin('nonexistent'))
    })
  })

  describe('resolveOriginalPluginId', () => {
    it('应通过 sanitizedId 还原原始 pluginId', () => {
      registry.refreshPlugin('@scope/my-plugin', 'My Plugin', [createTool('search')])
      assert.equal(registry.resolveOriginalPluginId('scope_my-plugin'), '@scope/my-plugin')
    })

    it('简单名称的 sanitizedId 等于原始 pluginId', () => {
      registry.refreshPlugin('simple-plugin', 'Simple', [createTool('search')])
      assert.equal(registry.resolveOriginalPluginId('simple-plugin'), 'simple-plugin')
    })

    it('移除插件后应清除逆向映射', () => {
      registry.refreshPlugin('@scope/test', 'Test', [createTool('search')])
      assert.equal(registry.resolveOriginalPluginId('scope_test'), '@scope/test')

      registry.removePlugin('@scope/test')
      assert.equal(registry.resolveOriginalPluginId('scope_test'), undefined)
    })

    it('clear 后应清除逆向映射', () => {
      registry.refreshPlugin('@scope/test', 'Test', [createTool('search')])
      registry.clear()
      assert.equal(registry.resolveOriginalPluginId('scope_test'), undefined)
    })
  })

  describe('resolveToolsForAi', () => {
    it('应返回正确格式的 AiTool 数组', () => {
      registry.refreshPlugin('my-plugin', 'My Plugin', [createTool('search', '搜索功能')])

      const aiTools = registry.resolveToolsForAi()
      assert.equal(aiTools.length, 1)

      const tool = aiTools[0]
      assert.equal(tool.type, 'function')
      assert.equal(tool.function?.name, 'plugin_tool__my-plugin__search')
      assert.ok(tool.function?.description?.includes('[Plugin:My Plugin]'))
      assert.ok(tool.function?.description?.includes('搜索功能'))
      assert.equal(tool.function?.parameters.type, 'object')
      assert.ok('query' in (tool.function?.parameters.properties ?? {}))
      assert.deepEqual(tool.function?.parameters.required, ['query'])
    })

    it('应正确规范化含特殊字符的 pluginId', () => {
      registry.refreshPlugin('@scope/translator', 'Translator', [createTool('translate', '翻译')])

      const aiTools = registry.resolveToolsForAi()
      const tool = aiTools[0]
      // function name 不应包含 @ 或 /
      assert.equal(tool.function?.name, 'plugin_tool__scope_translator__translate')
      assert.ok(!tool.function?.name?.includes('@'))
      assert.ok(!tool.function?.name?.includes('/'))
    })

    it('无注册工具时应返回空数组', () => {
      assert.deepEqual(registry.resolveToolsForAi(), [])
    })

    it('应返回多个插件的工具', () => {
      registry.refreshPlugin('plugin-a', 'Plugin A', [createTool('tool1'), createTool('tool2')])
      registry.refreshPlugin('plugin-b', 'Plugin B', [createTool('tool3')])

      const aiTools = registry.resolveToolsForAi()
      assert.equal(aiTools.length, 3)
    })
  })

  describe('clear', () => {
    it('应清空所有注册', () => {
      registry.refreshPlugin('plugin-a', 'Plugin A', [createTool('tool1')])
      registry.refreshPlugin('plugin-b', 'Plugin B', [createTool('tool2')])

      registry.clear()
      assert.equal(registry.getToolCount(), 0)
      assert.deepEqual(registry.resolveToolsForAi(), [])
    })
  })
})
