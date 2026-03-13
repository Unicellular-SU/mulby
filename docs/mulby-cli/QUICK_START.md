# Mulby CLI - AI 多供应商快速开始

## 🚀 快速配置

### 1. 添加 AI 供应商配置

```bash
# 推荐：快速配置默认 provider
mulby ai setup

# 需要多套配置时，再添加命名 provider
mulby ai add glm-main
mulby ai add openai-main
```

### 2. 查看所有配置

```bash
mulby ai list
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
mulby ai use glm-main
```

### 4. 创建插件

```bash
# 使用默认供应商创建插件
mulby create my-plugin --ai
```

### 4.1 AI 创建插件的固定流程

`mulby create xxx --ai` 现在建议按一套固定流程推进，而不是让模型直接“自由生成”：

1. 接入梳理：先读取 `manifest.json`、`src/main.ts`、`src/ui/App.tsx`
2. 需求确认：明确插件目标、`features/cmds` 触发方式、UI/后台/预加载分工
3. 接入契约：先约定要改哪些文件、每个 `feature.code` 如何映射、如何验证
4. 最小闭环：优先做一个能在 Mulby 中真正触发并跑通的 happy path
5. 完整实现：再补剩余功能、样式和交互细节
6. 接入验收：运行 `validate_plugin`，通过后再结束会话

这套流程参考了 uTools 官方开发文档里比较成熟的思路：先把 `plugin.json` / 入口脚本 / 预加载约束说清楚，再走开发调试、打包和发布，而不是一上来就堆代码。

## 📝 常用命令

### 配置管理

| 命令 | 说明 |
|------|------|
| `mulby ai setup` | 快速配置默认 provider（推荐） |
| `mulby ai add [name]` | 添加新配置，名称可省略 |
| `mulby ai list` | 列出所有配置 |
| `mulby ai show [name]` | 查看配置详情，默认查看当前默认配置 |
| `mulby ai use [name]` | 设置默认配置 |
| `mulby ai update [name]` | 更新配置，默认更新当前默认配置 |
| `mulby ai remove [name]` | 删除配置，默认删除当前默认配置 |

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
# 1. 快速配置默认 provider
mulby ai setup

# 2. 创建插件
mulby create weather-plugin --ai

# 3. 在会话中...
> 我想创建一个天气查询插件
```

### 示例 2: 会话中切换供应商

```bash
# 启动 AI 会话
mulby create my-plugin --ai

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
mulby ai add my-config --provider glm

# ❌ 错误
mulby config ai add my-config --provider glm
```

### 2. 未配置 AI 服务

**错误**: `未配置 AI 服务。请使用 mulby ai setup 快速配置，或使用 mulby ai add [name] 添加供应商配置。`

**解决**: 先添加至少一个供应商配置
```bash
mulby ai setup
```

### 3. 配置不存在

**错误**: `配置 "xxx" 不存在`

**解决**: 查看可用配置
```bash
mulby ai list
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
   mulby ai setup                              # 默认 provider
   mulby ai add design-ai --provider claude    # 产品设计
   mulby ai add code-ai --provider deepseek    # 代码生成
   mulby ai add fast-ai --provider gemini      # 快速原型
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
   mulby ai update my-config --api-key new-key
   ```

## 🚀 开始使用

```bash
# 1. 快速配置默认 provider
mulby ai setup

# 2. 创建插件
mulby create my-plugin --ai

# 3. 开始对话
> 我想创建一个...
```

就这么简单！🎉
