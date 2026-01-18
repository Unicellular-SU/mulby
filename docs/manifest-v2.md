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
| type | PluginType | 否 | 插件类型（utility/productivity/developer/system/media/network/ai/entertainment/other） |
| author | string | 否 | 作者名称 |
| homepage | string | 否 | 插件主页/网站 |
| displayName | string | 是 | 显示名称 |
| main | string | 是 | 入口文件 |
| ui | string | 否 | UI 文件路径 |
| icon | string/object | 否 | 插件图标 |
| features | array | 是 | 功能入口列表 |
| window | object | 否 | 独立窗口配置 |
| pluginSetting | object | 否 | 插件行为设置 |

### PluginSetting 配置

控制插件运行行为。

```json
{
  "pluginSetting": {
    "single": true,
    "height": 400
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| single | boolean | true | 是否单例模式运行（不允许多开） |
| height | number | - | 插件初始高度 |

### Window 配置

配置插件在独立窗口模式下的默认尺寸。

```json
{
  "window": {
    "width": 800,
    "height": 600,
    "minWidth": 400,
    "minHeight": 300,
    "maxWidth": 1200,
    "maxHeight": 900
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| width | number | 500 | 默认宽度 |
| height | number | 400 | 默认高度 |
| minWidth | number | 300 | 最小宽度 |
| minHeight | number | 200 | 最小高度 |
| maxWidth | number | - | 最大宽度（不设置则无限制） |
| maxHeight | number | - | 最大高度（不设置则无限制） |

### Feature 字段
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| code | string | 是 | 功能代码，传递给插件 |
| explain | string | 是 | 功能说明，显示给用户 |
| cmds | array | 是 | 触发命令列表 |
| mode | string | 否 | 执行模式（ui/silent/detached） |
| route | string | 否 | UI 路由 |
| icon | string/object | 否 | 功能独立图标（支持路径/svg/网络链接） |
| mainPush | boolean | 否 | 是否向搜索框推送内容 |
| mainHide | boolean | 否 | 触发该功能时不显示主窗口 |

### Cmd 类型
| type | 说明 | 额外字段 |
|------|------|----------|
| keyword | 关键词触发 | value: 关键词 |
| regex | 正则匹配 | match: 正则, explain: 说明, label?: 指令名称, minLength?: 最少字符数, maxLength?: 最多字符数 |
| files | 文件/文件夹 | exts?: 扩展名数组, fileType?: file/directory/any, match?: 文件名正则, minLength?: 最少数量, maxLength?: 最多数量 |
| img | 图片 | exts?: [".png", ".jpg"] |
| over | 选中文本 | label?: 指令名称, exclude?: 排除正则, minLength?: 最少字符数, maxLength?: 最多字符数 |

#### 文件/图片匹配说明

- `files`：当输入包含附件时，若任一附件扩展名命中 `exts` 列表则匹配。
- `img`：当输入包含图片附件时匹配；若提供 `exts`，则只匹配扩展名命中的图片。
- 扩展名可写成 `.png` 或 `png`，系统会自动规范化；支持 `*`/`.*` 作为通配。
- 当 `exts` 为空或未提供时，插件会接收全部附件；否则仅传递扩展名命中的附件。

示例：

```json
{
  "code": "pdf-only",
  "explain": "处理 PDF",
  "cmds": [
    { "type": "files", "exts": [".pdf"] }
  ]
}
```

若用户输入包含 `a.pdf`、`b.pdf`、`c.png`，则该 feature 会匹配，并且仅向插件传递两个 `.pdf` 附件。

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
