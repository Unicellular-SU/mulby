# InTools CLI 配置管理说明

## 两种配置命令

InTools CLI 提供了两种配置管理方式，各司其职：

### 1. `intools config` - 通用配置管理

**用途**: 底层的键值对配置管理，适用于简单配置

**命令**:
```bash
intools config get <key>           # 获取配置值
intools config set <key> <value>   # 设置配置值
intools config delete <key>        # 删除配置
intools config list                # 列出所有配置
```

**使用场景**:
- 查看底层配置结构
- 快速设置简单配置项
- 调试配置问题
- 管理非 AI 相关的配置

**示例**:
```bash
# 查看所有配置
intools config list

# 获取特定配置
intools config get ai.default

# 设置简单配置
intools config set theme dark

# 删除配置
intools config delete theme
```

### 2. `intools ai` - AI 专用配置管理

**用途**: 专门为 AI 供应商设计的友好配置管理

**命令**:
```bash
intools ai add <name>              # 添加 AI 供应商配置（交互式）
intools ai list                    # 列出所有 AI 配置
intools ai show <name>             # 查看配置详情
intools ai use <name>              # 设置默认配置
intools ai update <name>           # 更新配置
intools ai remove <name>           # 删除配置
```

**使用场景**:
- 添加和管理 AI 供应商
- 配置多个 AI 服务
- 切换默认供应商
- 更新 API Key 和模型

**示例**:
```bash
# 添加智谱AI配置（交互式）
intools ai add glm-main

# 或使用命令行参数
intools ai add glm-main \
  --provider glm \
  --api-key your-key \
  --model glm-4.7

# 列出所有 AI 配置
intools ai list

# 设置默认配置
intools ai use glm-main

# 更新配置
intools ai update glm-main --model glm-4-plus
```

## 两者的区别

| 特性 | `intools config` | `intools ai` |
|------|------------------|--------------|
| **定位** | 通用配置工具 | AI 专用配置 |
| **操作方式** | 键值对 | 结构化对象 |
| **交互性** | 命令行参数 | 交互式 + 参数 |
| **用户体验** | 简单直接 | 友好引导 |
| **适用场景** | 简单配置 | 复杂 AI 配置 |
| **配置验证** | 无 | 有（供应商、模型验证） |
| **API Key 显示** | 明文 | 掩码显示 |

## 配置存储结构

两者操作的是同一个配置文件 `~/.intools/config.json`：

```json
{
  "ai": {
    "default": "glm-main",
    "providers": {
      "glm-main": {
        "provider": "glm",
        "apiKey": "your-key",
        "model": "glm-4.7"
      }
    }
  },
  "theme": "dark",
  "other": "config"
}
```

- `intools config` 可以操作任何键值对
- `intools ai` 专门操作 `ai` 配置对象

## 使用建议

### 推荐使用 `intools ai`

对于 AI 相关配置，**强烈推荐使用 `intools ai`**：

✅ **优势**:
- 交互式引导，不易出错
- 自动验证供应商和模型
- API Key 掩码显示，更安全
- 友好的配置列表展示
- 支持配置覆盖确认

```bash
# 推荐方式
intools ai add my-glm --provider glm --api-key xxx
```

### 何时使用 `intools config`

在以下情况使用 `intools config`：

1. **快速查看配置**
   ```bash
   intools config list
   ```

2. **调试配置问题**
   ```bash
   intools config get ai.providers.glm-main.apiKey
   ```

3. **设置非 AI 配置**
   ```bash
   intools config set theme dark
   intools config set language zh-CN
   ```

4. **批量删除配置**
   ```bash
   intools config delete ai
   ```

## 实际使用示例

### 场景 1: 首次配置 AI

```bash
# 使用 intools ai（推荐）
intools ai add glm-main --provider glm --api-key xxx --model glm-4.7

# 查看配置
intools ai list
```

### 场景 2: 调试配置问题

```bash
# 查看完整配置结构
intools config list

# 检查特定配置
intools config get ai.default
intools config get ai.providers.glm-main
```

### 场景 3: 快速修改

```bash
# 使用 intools ai 更新（推荐）
intools ai update glm-main --model glm-4-plus

# 或使用 intools config（不推荐，容易出错）
intools config set ai.providers.glm-main.model glm-4-plus
```

### 场景 4: 管理其他配置

```bash
# 设置主题
intools config set theme dark

# 设置语言
intools config set language zh-CN

# 查看所有配置
intools config list
```

## 总结

- **`intools ai`** - AI 配置的首选工具，友好、安全、易用
- **`intools config`** - 底层配置工具，灵活、直接、强大

两者互补，各司其职，为用户提供了灵活的配置管理方式。

## 快速参考

```bash
# AI 配置（推荐）
intools ai add <name>              # 添加 AI 配置
intools ai list                    # 列出 AI 配置
intools ai use <name>              # 设置默认

# 通用配置
intools config list                # 查看所有配置
intools config get <key>           # 获取配置
intools config set <key> <value>   # 设置配置
```
