# InTools CLI - AI 多供应商支持实现总结

## 实现概述

成功为 InTools CLI 添加了多 AI 供应商支持，并实现了灵活的配置管理和会话中切换功能。

## 主要变更

### 1. 类型系统重构 (`src/types/ai.ts`)

**新增类型:**
- `AIProviderType` - 支持的供应商类型枚举
- `AIProviderConfig` - 单个供应商配置接口
- `AIConfig` - 多供应商配置结构

**新增常量:**
- `PROVIDER_MODELS` - 各供应商支持的模型列表
- `PROVIDER_ENDPOINTS` - 各供应商的默认端点
- `DEFAULT_PROVIDER_CONFIG` - 默认配置值

**配置结构变更:**
```typescript
// 旧结构
{
  ai: {
    provider: 'openai',
    apiKey: 'xxx',
    model: 'gpt-4o'
  }
}

// 新结构
{
  ai: {
    default: 'my-openai',
    providers: {
      'my-openai': {
        provider: 'openai',
        apiKey: 'xxx',
        model: 'gpt-4o'
      },
      'my-claude': {
        provider: 'claude',
        apiKey: 'xxx',
        model: 'claude-3-5-sonnet-20241022'
      }
    }
  }
}
```

### 2. 新增 AI 供应商

#### Gemini Provider (`src/services/ai/providers/gemini.ts`)
- 使用 Google Gemini REST API
- 支持函数调用和流式输出
- 默认模型: `gemini-2.0-flash-exp`

#### GLM Provider (`src/services/ai/providers/glm.ts`)
- **使用 OpenAI SDK**（智谱AI提供OpenAI兼容接口）
- 端点: `https://open.bigmodel.cn/api/paas/v4`
- 默认模型: `glm-4.7`（最新模型）
- 支持模型: glm-4.7, glm-4-plus, glm-4-air, glm-4-flash, glm-4-long
- 文档: https://docs.bigmodel.cn/cn/guide/develop/openai/introduction

#### DeepSeek Provider 优化
- **使用 OpenAI SDK**（DeepSeek提供OpenAI兼容接口）
- 端点更新: `https://api.deepseek.com`（移除 `/v1` 后缀）
- 新增模型: `deepseek-reasoner`（推理模型）
- 完全兼容 OpenAI API 格式

### 3. AIServiceFactory 重构 (`src/services/ai/index.ts`)

**新增方法:**
- `create(providerName?, modelOverride?)` - 创建供应商实例，支持运行时指定
- `listProviders()` - 获取所有已配置的供应商
- `getDefaultProvider()` - 获取默认供应商名称
- `getProviderConfig(name)` - 获取指定供应商配置

**核心改进:**
- 支持多个供应商配置共存
- 支持运行时切换供应商和模型
- 更清晰的错误提示

### 4. 配置管理命令 (`src/commands/config-ai.ts`)

新增 `intools config ai` 子命令系统:

| 命令 | 功能 |
|------|------|
| `add <name>` | 添加新的供应商配置 |
| `list` / `ls` | 列出所有配置 |
| `show <name>` | 查看配置详情 |
| `use <name>` | 设置默认配置 |
| `update <name>` | 更新配置 |
| `remove <name>` / `rm <name>` | 删除配置 |

**特性:**
- 交互式配置流程
- 自动模型选择
- API Key 掩码显示
- 配置覆盖确认

### 5. 会话中切换功能 (`src/services/ai-generator.ts`)

**新增斜杠命令:**
- `/use [name]` - 切换供应商配置
- `/model [name]` - 切换模型

**实现细节:**
- 在 `AIAgent` 类中添加 `currentProvider` 和 `currentModel` 属性
- 扩展 `handleSlashCommand` 方法
- 实时重新创建 `aiService` 实例
- 显示当前配置和可用选项

### 6. 创建命令更新 (`src/commands/create/ai-create.ts`)

- 适配新的配置结构
- 改进初始配置流程
- 支持所有新增供应商
- 更友好的错误提示

### 7. 主入口更新 (`src/index.ts`)

- 集成 `config ai` 子命令
- 保持向后兼容

## 文件清单

### 新增文件
- `src/services/ai/providers/gemini.ts` - Gemini 供应商实现
- `src/services/ai/providers/glm.ts` - GLM 供应商实现
- `src/commands/config-ai.ts` - AI 配置管理命令
- `packages/intools-cli/AI_PROVIDERS.md` - 用户文档

### 修改文件
- `src/types/ai.ts` - 类型系统重构
- `src/services/ai/index.ts` - 工厂类重构
- `src/services/ai/providers/base.ts` - 基类类型更新
- `src/services/ai/providers/openai.ts` - 适配新类型
- `src/services/ai/providers/claude.ts` - 适配新类型
- `src/services/ai/providers/deepseek.ts` - 适配新类型
- `src/services/ai-generator.ts` - 添加切换功能
- `src/commands/create/ai-create.ts` - 适配新配置
- `src/index.ts` - 集成新命令

## 使用示例

### 配置多个供应商

```bash
# 添加 OpenAI
intools config ai add openai-main \
  --provider openai \
  --api-key sk-xxx \
  --model gpt-4o

# 添加 Claude
intools config ai add claude-main \
  --provider claude \
  --api-key sk-ant-xxx \
  --model claude-3-5-sonnet-20241022

# 添加 Gemini
intools config ai add gemini-main \
  --provider gemini \
  --api-key AIza-xxx \
  --model gemini-2.0-flash-exp

# 查看所有配置
intools config ai list
```

### 会话中切换

```bash
# 启动 AI 会话
intools create my-plugin --ai

# 在会话中切换供应商
> /use claude-main
✓ 已切换到 "claude-main" (claude - claude-3-5-sonnet-20241022)

# 切换模型
> /model gpt-4o-mini
✓ 已切换模型为 "gpt-4o-mini"

# 查看可用配置
> /use

# 查看可用模型
> /model
```

## 技术亮点

1. **类型安全** - 完整的 TypeScript 类型定义
2. **向后兼容** - 保持现有 API 不变
3. **可扩展** - 易于添加新供应商
4. **用户友好** - 交互式配置和清晰的错误提示
5. **灵活切换** - 会话中实时切换供应商和模型

## 测试建议

1. **配置管理测试**
   - 添加/删除/更新配置
   - 设置默认配置
   - 配置覆盖场景

2. **供应商测试**
   - 测试每个供应商的基本调用
   - 测试工具调用功能
   - 测试流式输出

3. **会话切换测试**
   - 会话中切换供应商
   - 会话中切换模型
   - 切换后的功能正常性

4. **错误处理测试**
   - 无效的 API Key
   - 不存在的配置名称
   - 网络错误

## 后续改进建议

1. **配置导入/导出** - 支持配置文件的导入导出
2. **配置模板** - 提供常用配置的快速模板
3. **使用统计** - 记录各供应商的使用情况和成本
4. **配置验证** - 添加配置时验证 API Key 有效性
5. **配置加密** - 对敏感信息进行加密存储
6. **更多供应商** - 支持更多 AI 供应商（如 Cohere, Mistral 等）

## 兼容性说明

- **Node.js**: >= 16.0.0
- **TypeScript**: >= 4.5.0
- **现有配置**: 需要手动迁移到新格式（首次运行时会提示）

## 文档

详细使用文档请参考: `packages/intools-cli/AI_PROVIDERS.md`
