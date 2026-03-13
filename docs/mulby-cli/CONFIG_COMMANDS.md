# Mulby CLI 配置管理说明

## 两种配置命令

Mulby CLI 提供了两种配置管理方式，各司其职：

### 1. `mulby config` - 通用配置管理

**用途**: 底层的键值对配置管理，适用于简单配置

**命令**:
```bash
mulby config get <key>           # 获取配置值
mulby config set <key> <value>   # 设置配置值
mulby config delete <key>        # 删除配置
mulby config list                # 列出所有配置
```

**使用场景**:
- 查看底层配置结构
- 快速设置简单配置项
- 调试配置问题
- 管理非 AI 相关的配置

**示例**:
```bash
# 查看所有配置
mulby config list

# 获取特定配置
mulby config get ai.default

# 设置简单配置
mulby config set theme dark

# 删除配置
mulby config delete theme
```

### 2. `mulby ai` - AI 专用配置管理

**用途**: 专门为 AI 供应商设计的友好配置管理

**命令**:
```bash
mulby ai setup                   # 快速配置默认 provider（推荐）
mulby ai add [name]              # 添加 AI 供应商配置（交互式）
mulby ai list                    # 列出所有 AI 配置
mulby ai show [name]             # 查看配置详情
mulby ai use [name]              # 设置默认配置
mulby ai update [name]           # 更新配置
mulby ai remove [name]           # 删除配置
```

**使用场景**:
- 添加和管理 AI 供应商
- 配置多个 AI 服务
- 切换默认供应商
- 更新 API Key 和模型

**示例**:
```bash
# 快速配置默认 provider
mulby ai setup

# 添加额外 provider（名称可省略）
mulby ai add glm-main \
  --provider glm \
  --api-key your-key \
  --model glm-4.7

# 列出所有 AI 配置
mulby ai list

# 设置默认配置
mulby ai use glm-main

# 更新配置
mulby ai update glm-main --model glm-4-plus
```

## 两者的区别

| 特性 | `mulby config` | `mulby ai` |
|------|------------------|--------------|
| **定位** | 通用配置工具 | AI 专用配置 |
| **操作方式** | 键值对 | 结构化对象 |
| **交互性** | 命令行参数 | 交互式 + 参数 |
| **用户体验** | 简单直接 | 友好引导 |
| **适用场景** | 简单配置 | 复杂 AI 配置 |
| **配置验证** | 无 | 有（供应商、模型验证） |
| **API Key 显示** | 明文 | 掩码显示 |

## 配置存储结构

两者操作的是同一个配置文件 `~/.mulby/config.json`：

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

- `mulby config` 可以操作任何键值对
- `mulby ai` 专门操作 `ai` 配置对象

## 使用建议

### 推荐使用 `mulby ai`

对于 AI 相关配置，**强烈推荐使用 `mulby ai`**：

✅ **优势**:
- 交互式引导，不易出错
- 自动验证供应商和模型
- API Key 掩码显示，更安全
- 友好的配置列表展示
- 支持配置覆盖确认

```bash
# 推荐方式
mulby ai setup
```

### 何时使用 `mulby config`

在以下情况使用 `mulby config`：

1. **快速查看配置**
   ```bash
   mulby config list
   ```

2. **调试配置问题**
   ```bash
   mulby config get ai.providers.glm-main.apiKey
   ```

3. **设置非 AI 配置**
   ```bash
   mulby config set theme dark
   mulby config set language zh-CN
   ```

4. **批量删除配置**
   ```bash
   mulby config delete ai
   ```

## 实际使用示例

### 场景 1: 首次配置 AI

```bash
# 使用 mulby ai（推荐）
mulby ai setup

# 查看配置
mulby ai list
```

### 场景 2: 调试配置问题

```bash
# 查看完整配置结构
mulby config list

# 检查特定配置
mulby config get ai.default
mulby config get ai.providers.glm-main
```

### 场景 3: 快速修改

```bash
# 使用 mulby ai 更新（推荐）
mulby ai update glm-main --model glm-4-plus

# 或使用 mulby config（不推荐，容易出错）
mulby config set ai.providers.glm-main.model glm-4-plus
```

### 场景 4: 管理其他配置

```bash
# 设置主题
mulby config set theme dark

# 设置语言
mulby config set language zh-CN

# 查看所有配置
mulby config list
```

## 总结

- **`mulby ai`** - AI 配置的首选工具，友好、安全、易用
- **`mulby config`** - 底层配置工具，灵活、直接、强大

两者互补，各司其职，为用户提供了灵活的配置管理方式。

## 快速参考

```bash
# AI 配置（推荐）
mulby ai setup                   # 快速配置默认 provider
mulby ai add [name]              # 添加 AI 配置
mulby ai list                    # 列出 AI 配置
mulby ai use [name]              # 设置默认

# 通用配置
mulby config list                # 查看所有配置
mulby config get <key>           # 获取配置
mulby config set <key> <value>   # 设置配置
```
