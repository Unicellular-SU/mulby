# InTools CLI - AI 多供应商支持

## 概述

InTools CLI 现在支持多个 AI 供应商，并允许在会话中灵活切换供应商和模型。

## 支持的 AI 供应商

- **OpenAI** - GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo
- **Claude (Anthropic)** - Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
- **DeepSeek** - DeepSeek Chat, DeepSeek Reasoner (兼容 OpenAI API)
- **Gemini (Google)** - Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
- **GLM (智谱AI)** - GLM-4.7, GLM-4-Plus, GLM-4-Air, GLM-4-Flash, GLM-4-Long (兼容 OpenAI API)
- **Custom** - 自定义 OpenAI 兼容端点

## 配置管理

### 添加供应商配置

```bash
# 交互式添加配置
intools ai add my-openai

# 使用命令行参数
intools ai add my-claude \
  --provider claude \
  --api-key sk-ant-xxx \
  --model claude-3-5-sonnet-20241022
```

### 列出所有配置

```bash
intools ai list
# 或
intools ai ls
```

输出示例:
```
AI 供应商配置:

● my-openai (默认)
  供应商: openai
  模型: gpt-4o
  API Key: sk-***xxx

  my-claude
  供应商: claude
  模型: claude-3-5-sonnet-20241022
  API Key: sk-a***xxx
```

### 查看配置详情

```bash
intools ai show my-openai
```

### 设置默认配置

```bash
intools ai use my-claude
```

### 更新配置

```bash
# 更新 API Key
intools ai update my-openai --api-key sk-new-key

# 更新模型
intools ai update my-openai --model gpt-4o-mini

# 更新端点
intools ai update my-custom --endpoint https://api.example.com/v1
```

### 删除配置

```bash
intools ai remove my-openai
# 或
intools ai rm my-openai
```

## 会话中切换

在 AI 会话中，可以使用斜杠命令实时切换供应商和模型。

### 切换供应商

```bash
# 查看可用的供应商配置
/use

# 切换到指定配置
/use my-claude
```

### 切换模型

```bash
# 查看当前供应商的可用模型
/model

# 切换到指定模型
/model gpt-4o-mini
```

### 其他会话命令

```bash
/help          # 显示所有可用命令
/tokens        # 显示当前上下文的 token 使用情况
/compress      # 手动压缩上下文
/clear         # 清除对话历史（保留系统提示）
/exit          # 保存并退出会话
```

## 使用示例

### 示例 1: 配置多个供应商

```bash
# 添加 OpenAI 配置
intools ai add openai-main \
  --provider openai \
  --api-key sk-xxx \
  --model gpt-4o

# 添加 Claude 配置
intools ai add claude-main \
  --provider claude \
  --api-key sk-ant-xxx \
  --model claude-3-5-sonnet-20241022

# 添加 Gemini 配置
intools ai add gemini-main \
  --provider gemini \
  --api-key AIza-xxx \
  --model gemini-2.0-flash-exp

# 设置默认配置
intools ai use openai-main
```

### 示例 2: 会话中切换供应商

```bash
# 启动 AI 创建插件
intools create my-plugin --ai

# 在会话中...
> 我想创建一个天气插件

# 切换到 Claude（可能更擅长产品设计）
> /use claude-main
✓ 已切换到 "claude-main" (claude - claude-3-5-sonnet-20241022)

# 继续对话...
> 请帮我设计功能

# 切换到 DeepSeek（可能更擅长代码生成）
> /use deepseek-main
✓ 已切换到 "deepseek-main" (deepseek - deepseek-coder)

# 继续生成代码...
```

### 示例 3: 快速切换模型

```bash
# 使用更便宜的模型进行简单任务
> /model gpt-4o-mini
✓ 已切换模型为 "gpt-4o-mini"

# 遇到复杂问题时切换到更强大的模型
> /model gpt-4o
✓ 已切换模型为 "gpt-4o"
```

## 配置文件结构

配置存储在 `~/.intools/config.json`:

```json
{
  "ai": {
    "default": "my-openai",
    "providers": {
      "my-openai": {
        "provider": "openai",
        "apiKey": "sk-xxx",
        "model": "gpt-4o",
        "apiEndpoint": "https://api.openai.com/v1",
        "maxRetries": 3,
        "timeout": 60,
        "streaming": true
      },
      "my-claude": {
        "provider": "claude",
        "apiKey": "sk-ant-xxx",
        "model": "claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

## 供应商特定说明

### OpenAI
- **端点**: `https://api.openai.com/v1`
- **SDK**: 官方 OpenAI SDK
- **特性**: 支持工具调用和流式输出

### Claude (Anthropic)
- **端点**: 使用 SDK 默认端点
- **SDK**: 官方 Anthropic SDK
- **特性**: 支持工具调用和流式输出
- **说明**: 系统消息作为顶级参数传递

### DeepSeek
- **端点**: `https://api.deepseek.com`
- **SDK**: OpenAI SDK（兼容接口）
- **特性**: 支持工具调用、流式输出、推理内容提取
- **最新模型**: deepseek-reasoner（推理模型）
- **说明**: 完全兼容 OpenAI API 格式

### Gemini (Google)
- **端点**: `https://generativelanguage.googleapis.com/v1beta`
- **SDK**: REST API
- **特性**: 支持函数调用和流式输出
- **说明**: 使用 Google 原生 API 格式

### GLM (智谱AI)
- **端点**: `https://open.bigmodel.cn/api/paas/v4`
- **SDK**: OpenAI SDK（兼容接口）
- **特性**: 支持工具调用和流式输出
- **最新模型**: glm-4.7
- **文档**: https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
- **说明**: 完全兼容 OpenAI API 格式，可直接使用 OpenAI SDK

### Custom
- **端点**: 自定义
- **SDK**: OpenAI SDK
- **说明**: 支持任何 OpenAI 兼容的 API 端点，需要手动指定端点 URL

## 迁移指南

如果你之前使用旧的配置格式，需要迁移到新格式：

### 旧格式
```json
{
  "ai": {
    "provider": "openai",
    "apiKey": "sk-xxx",
    "model": "gpt-4o"
  }
}
```

### 新格式
```json
{
  "ai": {
    "default": "default",
    "providers": {
      "default": {
        "provider": "openai",
        "apiKey": "sk-xxx",
        "model": "gpt-4o"
      }
    }
  }
}
```

### 自动迁移

首次运行 `intools create --ai` 时，如果检测到旧配置，会提示你配置新格式。

## 故障排除

### 配置未找到

```bash
错误: 未配置 AI 服务。请使用 `intools ai add <name>` 添加供应商配置。
```

解决方法: 使用 `intools ai add` 添加至少一个供应商配置。

### 供应商切换失败

```bash
❌ 未找到配置 "my-provider"
```

解决方法: 使用 `/use` 命令（不带参数）查看可用的配置列表。

### API 调用失败

检查:
1. API Key 是否正确
2. API 端点是否可访问
3. 模型名称是否正确
4. 账户是否有足够的配额

## 最佳实践

1. **为不同用途配置多个供应商**
   - 产品设计: Claude
   - 代码生成: DeepSeek/GPT-4
   - 快速原型: Gemini Flash

2. **使用描述性的配置名称**
   - ✅ `openai-gpt4o`, `claude-sonnet`, `gemini-flash`
   - ❌ `config1`, `test`, `temp`

3. **定期更新 API Key**
   - 使用 `intools ai update` 命令

4. **监控 token 使用**
   - 使用 `/tokens` 命令查看上下文大小
   - 使用 `/compress` 命令压缩历史

5. **根据任务选择模型**
   - 简单任务: 使用更便宜的模型（如 gpt-4o-mini）
   - 复杂任务: 使用更强大的模型（如 gpt-4o, claude-3-5-sonnet）
