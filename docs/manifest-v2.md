# InTools 插件 Manifest 规范 v2

## 核心概念

### Features（功能入口）
一个插件可以有多个功能入口，每个功能入口可以有不同的触发方式。

## manifest.json 结构

```json
{
  "name": "json-tools",
  "version": "1.0.0",
  "displayName": "JSON 工具箱",
  "description": "JSON 格式化、压缩、校验等功能",
  "main": "main.js",
  "features": [
    {
      "code": "format",
      "explain": "格式化 JSON",
      "cmds": [
        { "type": "keyword", "value": "json" },
        { "type": "keyword", "value": "格式化" },
        { "type": "regex", "match": "^\\s*[{\\[]", "explain": "检测到 JSON" }
      ]
    },
    {
      "code": "minify",
      "explain": "压缩 JSON",
      "cmds": [
        { "type": "keyword", "value": "json压缩" }
      ]
    }
  ]
}
```

## 字段说明

### 顶层字段
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 插件唯一标识 |
| version | string | 是 | 版本号 |
| displayName | string | 是 | 显示名称 |
| main | string | 是 | 入口文件 |
| ui | string | 否 | UI 文件路径 |
| icon | string/object | 否 | 插件图标 |
| features | array | 是 | 功能入口列表 |

### Feature 字段
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| code | string | 是 | 功能代码，传递给插件 |
| explain | string | 是 | 功能说明，显示给用户 |
| cmds | array | 是 | 触发命令列表 |

### Cmd 类型
| type | 说明 | 额外字段 |
|------|------|----------|
| keyword | 关键词触发 | value: 关键词 |
| regex | 正则匹配 | match: 正则, explain: 说明 |
| files | 文件类型 | exts: [".json", ".txt"] |
| img | 图片 | - |
| over | 选中文本 | - |

### Icon 字段

插件图标支持三种格式，可使用字符串简写或对象形式。

#### 字符串简写

```json
// 本地文件
"icon": "icon.png"

// URL
"icon": "https://example.com/icon.png"

// 内联 SVG
"icon": "<svg viewBox=\"0 0 24 24\">...</svg>"
```

#### 对象形式

```json
// 本地文件
"icon": { "type": "file", "value": "assets/logo.png" }

// URL
"icon": { "type": "url", "value": "https://example.com/icon.png" }

// SVG
"icon": { "type": "svg", "value": "<svg>...</svg>" }
```

#### 默认行为

- 未设置 `icon` 时，自动尝试加载插件目录下的 `icon.png`
- 若无图标文件，显示默认占位图标
