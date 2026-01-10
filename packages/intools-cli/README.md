# InTools CLI

InTools 插件开发的命令行工具，帮助你快速创建、调试、构建和打包插件。

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [插件开发指南](#插件开发指南)
  - [项目结构](#项目结构)
  - [manifest.json 配置](#manifestjson-配置)
  - [开发模式](#开发模式)
  - [使用第三方库](#使用第三方库)
  - [插件 API](#插件-api)
- [构建与打包](#构建与打包)
- [完整示例](#完整示例)

---

## 安装

```bash
# 全局安装
npm install -g intools-cli

# 或在项目中作为开发依赖
npm install -D intools-cli
```

---

## 快速开始

### 5 分钟创建你的第一个插件

```bash
# 1. 创建插件项目
intools create my-plugin

# 2. 进入项目目录
cd my-plugin

# 3. 安装依赖
npm install

# 4. 启动开发模式
npm run dev

# 5. 构建插件
npm run build

# 6. 打包发布
npm run pack
```

执行完成后，你将得到一个 `my-plugin-1.0.0.inplugin` 文件，可以直接安装到 InTools 中。

---

## 命令参考

### `intools create <name>`

创建新的插件项目。

```bash
# 创建 React 插件（默认，带 UI）
intools create my-plugin

# 创建基础插件（无 UI）
intools create my-plugin --template basic
```

**选项:**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-t, --template <type>` | 模板类型：`react` 或 `basic` | `react` |

### `intools dev`

启动开发模式，支持热重载。

```bash
# 在插件目录中运行
intools dev

# 或通过 npm
npm run dev
```

**功能:**
- 后端代码变化时自动重新构建
- 有 UI 的插件会自动启动 Vite 开发服务器
- 支持 sourcemap 便于调试

### `intools build`

构建插件，生成生产环境代码。

```bash
intools build

# 或通过 npm
npm run build
```

**输出:**
- 后端代码：`dist/main.js`（压缩后）
- UI 代码：`ui/` 目录

### `intools pack`

将插件打包成 `.inplugin` 文件，用于发布和安装。

```bash
intools pack

# 或通过 npm
npm run pack
```

**输出:** `<插件名>-<版本号>.inplugin`

> ⚠️ **注意:** 打包前请先运行 `intools build` 或 `npm run build`

---

## 插件开发指南

### 项目结构

#### React 插件（默认模板）

```
my-plugin/
├── package.json          # npm 配置
├── manifest.json         # 插件配置（核心文件）
├── tsconfig.json         # TypeScript 配置
├── vite.config.ts        # Vite 配置
├── icon.png              # 插件图标
├── src/
│   ├── main.ts           # 后端逻辑（沙箱运行）
│   ├── types/
│   │   └── intools.d.ts  # API 类型定义
│   └── ui/               # React UI 源码
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── styles.css
├── dist/                 # 后端构建输出
│   └── main.js
└── ui/                   # UI 构建输出
    ├── index.html
    └── assets/
```

#### 基础插件（无 UI）

```
my-plugin/
├── package.json
├── manifest.json
├── icon.png
└── src/
    └── main.ts
```

---

### manifest.json 配置

`manifest.json` 是插件的核心配置文件，定义了插件的基本信息和触发条件。

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "我的插件",
  "description": "插件功能描述",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "features": [
    {
      "code": "main",
      "explain": "主功能",
      "cmds": [
        { "type": "keyword", "value": "myplugin" }
      ]
    }
  ]
}
```

#### 顶层字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件唯一标识（小写字母、数字、连字符） |
| `version` | string | ✅ | 语义化版本 (x.y.z) |
| `displayName` | string | ✅ | 用户看到的名称 |
| `description` | string | ✅ | 功能描述 |
| `main` | string | ✅ | 后端入口文件路径 |
| `ui` | string | ❌ | UI 文件路径（有界面时必填） |
| `icon` | string/object | ❌ | 插件图标 |
| `features` | array | ✅ | 功能入口列表 |
| `author` | string | ❌ | 作者名 |
| `homepage` | string | ❌ | 项目主页 |
| `minAppVersion` | string | ❌ | 最低 InTools 版本要求 |

#### 功能入口 (features)

一个插件可以有多个功能入口，每个入口可以有不同的触发方式：

```json
{
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

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `code` | string | ✅ | 功能代码，传递给插件 |
| `explain` | string | ✅ | 功能说明，显示给用户 |
| `cmds` | array | ✅ | 触发命令列表 |

#### 触发命令类型 (cmds)

| type | 说明 | 额外字段 |
|------|------|----------|
| `keyword` | 关键词触发 | `value`: 关键词 |
| `regex` | 正则匹配 | `match`: 正则表达式, `explain`: 说明 |
| `files` | 文件类型 | `exts`: [".json", ".txt"] |
| `img` | 图片 | - |
| `over` | 选中文本 | - |

#### 图标配置

支持三种格式：

```json
// 1. 本地文件（推荐）
"icon": "icon.png"

// 2. URL
"icon": "https://example.com/icon.png"

// 3. 内联 SVG
"icon": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"...\"/></svg>"
```

> 💡 **提示:** 未设置 `icon` 时，会自动尝试加载插件目录下的 `icon.png`

---

### 开发模式

#### 启动开发服务器

```bash
npm run dev
```

开发模式会：
1. **监听后端代码变化** - `src/main.ts` 及其依赖变化时自动重新构建
2. **启动 Vite 开发服务器** - 有 UI 时自动启动，支持 HMR（热模块替换）

#### 在 InTools 中预览

1. 打开 InTools 设置
2. 添加开发目录（插件项目路径）
3. 输入关键词触发插件

---

### 使用第三方库

InTools CLI 使用 **esbuild** 打包，会将所有依赖内联到 `dist/main.js` 中，因此你可以自由使用任何 npm 包。

#### 示例：使用 dayjs 处理日期

**1. 安装依赖**

```bash
npm install dayjs
```

**2. 在代码中使用**

```typescript
// src/main.ts
import dayjs from 'dayjs'

module.exports = {
  async run(context: any) {
    const { clipboard, notification } = context.api
    const text = context.input || await clipboard.readText()

    // 使用 dayjs 格式化日期
    const result = dayjs(text).format('YYYY-MM-DD HH:mm:ss')

    await clipboard.writeText(result)
    notification.show('日期格式化完成')
  }
}
```

**3. 构建**

```bash
npm run build
```

构建后，`dayjs` 的代码会被内联到 `dist/main.js` 中，无需用户单独安装。

---

### 插件 API

插件在沙箱中运行，通过 `context.api` 访问各种 API。

#### 剪贴板 API (clipboard)

```typescript
const { clipboard } = context.api

// 读取文本
const text = clipboard.readText()

// 写入文本
await clipboard.writeText('Hello World')

// 读取图片（返回 PNG Buffer）
const imageBuffer = clipboard.readImage()

// 写入图片
clipboard.writeImage(imageData)

// 读取文件列表
const files = clipboard.readFiles()
// 返回: [{ path, name, size, isDirectory }]

// 获取剪贴板格式
const format = clipboard.getFormat()
// 返回: 'text' | 'image' | 'files' | 'empty'
```

#### 通知 API (notification)

```typescript
const { notification } = context.api

notification.show('操作成功')
notification.show('发生错误', 'error')
// type: 'info' | 'success' | 'warning' | 'error'
```

#### 存储 API (storage)

```typescript
const { storage } = context.api

// 存储数据
await storage.set('key', { foo: 'bar' })

// 读取数据
const data = await storage.get('key')

// 删除数据
await storage.remove('key')
```

#### 网络 API (http)

```typescript
const { http } = context.api

// 完整请求
const response = await http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: { key: 'value' },
  timeout: 5000
})

// 快捷方法
await http.get(url, headers?)
await http.post(url, body?, headers?)
await http.put(url, body?, headers?)
await http.delete(url, headers?)
```

#### 窗口 API (window)

```typescript
const { window } = context.api

// 设置窗口大小
await window.setSize(600, 400)

// 隐藏窗口
await window.hide()
```

#### 文件系统 API (filesystem)

```typescript
const { filesystem } = context.api

// 读写文件
const buffer = filesystem.readFile('/path/to/file.png')
const text = filesystem.readFile('/path/to/file.txt', 'utf-8')
filesystem.writeFile('/path/to/output.txt', 'content', 'utf-8')

// 文件操作
filesystem.exists('/path')
filesystem.unlink('/path')
filesystem.mkdir('/path')
filesystem.readdir('/path')
filesystem.stat('/path')
filesystem.copy(src, dest)
filesystem.move(src, dest)

// 路径工具
filesystem.extname('/file.txt')   // '.txt'
filesystem.dirname('/path/file')  // '/path'
filesystem.basename('/path/file.txt')  // 'file.txt'
filesystem.join('/path', 'to', 'file')
```

---

### 插件 UI

#### 在 UI 中访问 API

UI 通过 `window.intools` 全局对象访问 API：

```tsx
// src/ui/App.tsx
import { useEffect, useState } from 'react'

export default function App() {
  const [input, setInput] = useState('')

  // 接收插件初始化数据
  useEffect(() => {
    window.intools?.onPluginInit?.((data) => {
      if (data.input) setInput(data.input)
    })
  }, [])

  const handleProcess = async () => {
    const result = input.toUpperCase()
    // 复制到剪贴板
    await window.intools?.clipboard?.writeText(result)
    // 显示通知
    window.intools?.notification?.show('已复制到剪贴板')
  }

  return (
    <div>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={handleProcess}>处理</button>
    </div>
  )
}
```

#### 主题适配

插件 UI 应跟随 InTools 主题：

```tsx
// 获取初始主题
function getInitialTheme(): 'light' | 'dark' {
  const params = new URLSearchParams(window.location.search)
  return (params.get('theme') as 'light' | 'dark') || 'light'
}

// 监听主题变化
useEffect(() => {
  window.intools?.onThemeChange?.((theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  })
}, [])
```

---

### 生命周期钩子

插件支持生命周期钩子函数：

```typescript
module.exports = {
  // 插件加载时调用
  onLoad() {
    console.log('插件已加载')
  },

  // 插件卸载时调用
  onUnload() {
    console.log('插件即将卸载')
  },

  // 插件启用时调用
  onEnable() {
    console.log('插件已启用')
  },

  // 插件禁用时调用
  onDisable() {
    console.log('插件已禁用')
  },

  // 主执行函数
  async run(context) {
    // 插件主逻辑
  }
}
```

| 钩子 | 触发时机 | 用途 |
|------|----------|------|
| `onLoad` | 插件加载时 | 初始化资源、注册服务 |
| `onUnload` | 插件卸载时 | 清理资源、保存状态 |
| `onEnable` | 插件启用时 | 恢复服务、重新注册 |
| `onDisable` | 插件禁用时 | 暂停服务、释放资源 |

---

## 构建与打包

### 构建流程

```bash
# 构建生产版本
npm run build
```

构建命令会：
1. 使用 esbuild 打包后端代码到 `dist/main.js`（压缩）
2. 使用 Vite 构建 UI 到 `ui/` 目录（如果有 UI）

### 打包发布

```bash
# 打包成 .inplugin 文件
npm run pack
```

生成的 `.inplugin` 文件实际上是 ZIP 格式，包含：

```
my-plugin-1.0.0.inplugin
├── manifest.json      # 插件配置
├── main.js            # 打包后的后端代码
├── icon.png           # 图标（可选）
└── ui/                # UI 资源（可选）
    ├── index.html
    └── assets/
```

### 安装插件

用户可以通过以下方式安装 `.inplugin` 文件：

1. **双击安装** - 直接双击 `.inplugin` 文件
2. **拖拽安装** - 将文件拖入 InTools 窗口
3. **命令安装** - `intools install ./my-plugin.inplugin`

---

## 完整示例

### 示例 1：JSON 格式化插件（无 UI）

```bash
intools create json-formatter --template basic
cd json-formatter
```

**manifest.json:**
```json
{
  "name": "json-formatter",
  "version": "1.0.0",
  "displayName": "JSON 格式化",
  "description": "格式化或压缩 JSON 数据",
  "main": "dist/main.js",
  "icon": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M5 3h2v2H5v5a2 2 0 01-2 2 2 2 0 012 2v5h2v2H5c-1.1 0-2-.9-2-2v-4a2 2 0 00-2-2H0v-2h1a2 2 0 002-2V5a2 2 0 012-2zm14 0a2 2 0 012 2v4a2 2 0 002 2h1v2h-1a2 2 0 00-2 2v4a2 2 0 01-2 2h-2v-2h2v-5a2 2 0 012-2 2 2 0 01-2-2V5h-2V3h2z\"/></svg>",
  "features": [
    {
      "code": "format",
      "explain": "格式化 JSON",
      "cmds": [
        { "type": "keyword", "value": "json" },
        { "type": "regex", "match": "^\\s*[{\\[]", "explain": "检测到 JSON" }
      ]
    }
  ]
}
```

**src/main.ts:**
```typescript
module.exports = {
  async run(context: any) {
    const { clipboard, notification } = context.api
    const text = context.input || await clipboard.readText()

    try {
      const obj = JSON.parse(text)
      const formatted = JSON.stringify(obj, null, 2)
      await clipboard.writeText(formatted)
      notification.show('JSON 格式化成功')
    } catch (e) {
      notification.show('无效的 JSON', 'error')
    }
  }
}
```

### 示例 2：翻译插件（带 UI）

```bash
intools create translator
cd translator
npm install
```

**manifest.json:**
```json
{
  "name": "translator",
  "version": "1.0.0",
  "displayName": "快速翻译",
  "description": "中英文互译",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "features": [
    {
      "code": "translate",
      "explain": "翻译文本",
      "cmds": [
        { "type": "keyword", "value": "fy" },
        { "type": "keyword", "value": "翻译" }
      ]
    }
  ]
}
```

**src/main.ts:**
```typescript
module.exports = {
  onLoad() {
    console.log('翻译插件已加载')
  },

  async run(context: any) {
    // UI 插件通常不需要在 run 中做太多事
    // 主要逻辑在 UI 中处理
  }
}
```

**src/ui/App.tsx:**
```tsx
import { useEffect, useState } from 'react'

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.intools?.onPluginInit?.((data) => {
      if (data.input) setInput(data.input)
    })
  }, [])

  const handleTranslate = async () => {
    if (!input.trim()) return
    
    setLoading(true)
    try {
      // 调用翻译 API
      const response = await fetch('https://api.translate.com/v1/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, from: 'auto', to: 'en' })
      })
      const data = await response.json()
      setOutput(data.translation)
    } catch (error) {
      window.intools?.notification?.show('翻译失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await window.intools?.clipboard?.writeText(output)
    window.intools?.notification?.show('已复制')
  }

  return (
    <div className="app">
      <div className="titlebar">快速翻译</div>
      <div className="container">
        <textarea 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入要翻译的文本..."
        />
        <button onClick={handleTranslate} disabled={loading}>
          {loading ? '翻译中...' : '翻译'}
        </button>
        <textarea 
          value={output} 
          readOnly 
          placeholder="翻译结果..."
        />
        {output && <button onClick={handleCopy}>复制结果</button>}
      </div>
    </div>
  )
}
```

---

## 常见问题

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发模式，后端代码支持 sourcemap。可以在 InTools 的开发者工具中查看日志和调试。

### Q: 为什么我的第三方库不能用？

A: 确保依赖已安装（`npm install`）并且使用 `npm run build` 构建。CLI 会自动将依赖打包到 `dist/main.js` 中。

### Q: 如何更新已安装的插件？

A: 修改 `manifest.json` 中的 `version` 字段，重新打包后安装即可。InTools 会检测版本变化并更新。

### Q: 插件可以访问系统命令吗？

A: 出于安全考虑，默认不开放 `shell` 权限。如需使用，请在 `manifest.json` 的 `permissions` 中声明，并等待审核。

---

## 相关文档

- [InTools 插件开发规范](../../docs/plugin-spec.md)
- [InTools API 接口参考](../../docs/api-reference.md)
- [Manifest 规范 v2](../../docs/manifest-v2.md)
- [插件打包说明](../../docs/plugin-packaging.md)
