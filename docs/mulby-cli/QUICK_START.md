# InTools CLI - AI 多供应商快速开始

## 🚀 快速配置

### 1. 添加 AI 供应商配置

```bash
# 智谱AI (GLM) - 最新模型 glm-4.7
intools ai add glm-main \
  --provider glm \
  --api-key your-glm-api-key \
  --model glm-4.7

# OpenAI
intools ai add openai-main \
  --provider openai \
  --api-key sk-xxx \
  --model gpt-4o

# Claude
intools ai add claude-main \
  --provider claude \
  --api-key sk-ant-xxx \
  --model claude-3-5-sonnet-20241022

# DeepSeek - 推理模型
intools ai add deepseek-main \
  --provider deepseek \
  --api-key your-deepseek-key \
  --model deepseek-reasoner

# Gemini
intools ai add gemini-main \
  --provider gemini \
  --api-key AIza-xxx \
  --model gemini-2.0-flash-exp
```

### 2. 查看所有配置

```bash
intools ai list
```

输出示例：
```
AI 供应商配置:

● glm-main (默认)
  供应商: glm
  模型: glm-4.7
  API Key: your***key

  openai-main
  供应商: openai
  模型: gpt-4o
  API Key: sk-***xxx
```

### 3. 设置默认供应商

```bash
intools ai use glm-main
```

### 4. 创建插件

```bash
# 使用默认供应商创建插件
intools create my-plugin --ai
```

## 📝 常用命令

### 配置管理

| 命令 | 说明 |
|------|------|
| `intools ai add <name>` | 添加新配置（交互式） |
| `intools ai list` | 列出所有配置 |
| `intools ai show <name>` | 查看配置详情 |
| `intools ai use <name>` | 设置默认配置 |
| `intools ai update <name>` | 更新配置 |
| `intools ai remove <name>` | 删除配置 |

### 会话中命令

在 AI 会话中使用斜杠命令：

| 命令 | 说明 |
|------|------|
| `/use [name]` | 切换供应商（不带参数显示列表） |
| `/model [name]` | 切换模型（不带参数显示列表） |
| `/tokens` | 显示 token 使用情况 |
| `/compress` | 压缩对话历史 |
| `/clear` | 清除对话历史 |
| `/help` | 显示帮助 |
| `/exit` | 保存并退出 |

## 💡 使用示例

### 示例 1: 配置智谱AI并创建插件

```bash
# 1. 添加智谱AI配置
intools ai add my-glm \
  --provider glm \
  --api-key your-api-key \
  --model glm-4.7

# 2. 设为默认
intools ai use my-glm

# 3. 创建插件
intools create weather-plugin --ai

# 4. 在会话中...
> 我想创建一个天气查询插件
```

### 示例 2: 会话中切换供应商

```bash
# 启动 AI 会话
intools create my-plugin --ai

# 使用 Claude 进行产品设计
> /use claude-main
✓ 已切换到 "claude-main" (claude - claude-3-5-sonnet-20241022)

> 请帮我设计这个插件的功能

# 切换到 DeepSeek 进行代码生成
> /use deepseek-main
✓ 已切换到 "deepseek-main" (deepseek - deepseek-reasoner)

> 请生成代码实现
```

### 示例 3: 切换模型节省成本

```bash
# 简单任务使用便宜的模型
> /model gpt-4o-mini
✓ 已切换模型为 "gpt-4o-mini"

# 复杂任务切换到强大模型
> /model gpt-4o
✓ 已切换模型为 "gpt-4o"
```

## 🔧 供应商特性

### 智谱AI (GLM)
- ✅ **OpenAI 兼容** - 使用 OpenAI SDK
- ✅ **最新模型** - glm-4.7
- ✅ **长文本支持** - glm-4-long
- 📚 [官方文档](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)

### DeepSeek
- ✅ **OpenAI 兼容** - 使用 OpenAI SDK
- ✅ **推理模型** - deepseek-reasoner
- ✅ **代码生成** - deepseek-chat

### OpenAI
- ✅ **官方 SDK**
- ✅ **最新模型** - gpt-4o, gpt-4o-mini

### Claude
- ✅ **官方 SDK**
- ✅ **最新模型** - claude-3-5-sonnet

### Gemini
- ✅ **REST API**
- ✅ **最新模型** - gemini-2.0-flash-exp

## ⚠️ 常见问题

### 1. 命令找不到选项

**错误**: `error: unknown option '--provider'`

**原因**: 使用了错误的命令格式

**正确格式**:
```bash
# ✅ 正确
intools ai add my-config --provider glm

# ❌ 错误
intools config ai add my-config --provider glm
```

### 2. 未配置 AI 服务

**错误**: `未配置 AI 服务。请使用 intools ai add <name> 添加供应商配置。`

**解决**: 先添加至少一个供应商配置
```bash
intools ai add my-glm --provider glm --api-key your-key
```

### 3. 配置不存在

**错误**: `配置 "xxx" 不存在`

**解决**: 查看可用配置
```bash
intools ai list
```

### 4. API 调用失败

**检查清单**:
- [ ] API Key 是否正确
- [ ] 网络是否可访问 API 端点
- [ ] 模型名称是否正确
- [ ] 账户是否有足够配额

## 📚 更多文档

- **完整文档**: `AI_PROVIDERS.md`
- **技术实现**: `CHANGELOG_AI_PROVIDERS.md`
- **优化说明**: `OPTIMIZATION_SUMMARY.md`

## 🎯 最佳实践

1. **为不同场景配置多个供应商**
   ```bash
   intools ai add design-ai --provider claude    # 产品设计
   intools ai add code-ai --provider deepseek    # 代码生成
   intools ai add fast-ai --provider gemini      # 快速原型
   ```

2. **使用描述性名称**
   - ✅ `glm-main`, `openai-gpt4o`, `claude-sonnet`
   - ❌ `config1`, `test`, `temp`

3. **监控成本**
   - 使用 `/tokens` 查看上下文大小
   - 简单任务使用便宜模型
   - 复杂任务使用强大模型

4. **定期更新**
   ```bash
   intools ai update my-config --api-key new-key
   ```

## 🚀 开始使用

```bash
# 1. 添加配置
intools ai add my-glm --provider glm --api-key your-key --model glm-4.7

# 2. 创建插件
intools create my-plugin --ai

# 3. 开始对话
> 我想创建一个...
```

就这么简单！🎉
