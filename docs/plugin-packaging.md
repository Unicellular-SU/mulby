# Mulby 插件打包与第三方库支持设计

## 问题分析

### 当前限制

1. **第三方库无法使用**
   - vm2 沙箱中 `require` 被禁用
   - 插件无法引入 npm 包（如 lodash、dayjs、axios 等）

2. **安装不便**
   - 插件以目录形式存在
   - 用户需手动复制到 plugins 目录
   - 无版本管理和更新机制

## 解决方案

### 方案对比

| 方案 | 第三方库 | 安全性 | 复杂度 | 推荐 |
|------|---------|--------|--------|------|
| A. 预置常用库 | 有限支持 | 高 | 低 | 否 |
| B. 声明依赖 + 容器安装 | 完整支持 | 中 | 高 | 否 |
| C. 插件打包（推荐） | 完整支持 | 高 | 中 | 是 |
| D. Worker Threads | 完整支持 | 低 | 中 | 否 |

### 推荐方案：插件打包 (方案 C)

**核心思路：**
- 插件开发时使用 esbuild/rollup 打包
- 将所有依赖打包成单个 JS 文件
- 最终打包成 `.inplugin` 文件（zip 格式）
- 容器加载时解压并运行

**优势：**
- 依赖自包含，无需容器安装
- 沙箱安全性不变
- 分发简单，双击安装
- 支持任意 npm 包

---

## 插件打包格式 (.inplugin)

### 文件结构

```
my-plugin.inplugin (实际是 zip 格式)
├── manifest.json      # 插件配置
├── main.js            # 打包后的入口（包含所有依赖）
├── icon.png           # 图标（可选）
└── ui/                # UI 资源（可选）
    ├── index.html
    └── assets/
```

### manifest.json 扩展字段

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "我的插件",
  "description": "插件描述",
  "main": "main.js",
  "features": [...],

  "author": "作者名",
  "homepage": "https://github.com/xxx",
  "repository": "https://github.com/xxx/my-plugin",
  "license": "MIT",
  "minAppVersion": "1.0.0",
  "platform": ["darwin", "win32", "linux"]
}
```

---

## 插件开发工作流

### 开发目录结构

```
my-plugin/
├── package.json       # npm 配置
├── src/
│   └── main.ts        # 源码（可用 TypeScript）
├── ui/                # UI 源码（可选）
│   └── index.html
├── manifest.json      # 插件配置
└── dist/              # 打包输出
    └── main.js
```

### package.json 示例

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "scripts": {
    "build": "esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js",
    "pack": "mulby-cli pack"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "@anthropic/mulby-cli": "^1.0.0"
  },
  "dependencies": {
    "lodash": "^4.17.21",
    "dayjs": "^1.11.10"
  }
}
```

### 开发命令

```bash
# 1. 创建插件项目
mulby-cli create my-plugin

# 2. 安装依赖
cd my-plugin && npm install

# 3. 开发模式（热重载）
npm run dev

# 4. 构建
npm run build

# 5. 打包成 .inplugin
npm run pack
# 输出: my-plugin-1.0.0.inplugin
```

---

## 容器安装流程

### 安装方式

1. **双击安装**：用户双击 `.inplugin` 文件
2. **拖拽安装**：拖入 Mulby 窗口
3. **命令安装**：`mulby install ./my-plugin.inplugin`

### 安装过程

```
1. 验证文件格式（zip 签名）
2. 解压到临时目录
3. 读取并验证 manifest.json
4. 检查版本兼容性
5. 复制到 plugins 目录
6. 重新加载插件列表
```

---

## 示例：使用第三方库的插件

### 日期格式化插件（使用 dayjs）

**src/main.ts**
```typescript
import dayjs from 'dayjs'

module.exports = {
  async run(context: any) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()

    let result: string
    if (featureCode === 'format') {
      result = dayjs(text).format('YYYY-MM-DD HH:mm:ss')
    } else {
      result = dayjs().format(text || 'YYYY-MM-DD')
    }

    await clipboard.writeText(result)
    notification.show('日期格式化完成')
  }
}
```

**打包后 dist/main.js**（dayjs 被内联）
```javascript
// esbuild 会将 dayjs 代码内联到这里
// 最终文件约 10KB（压缩后）
var dayjs = /* ... bundled dayjs code ... */
module.exports = {
  async run(context) { /* ... */ }
}
```

---

## 实现计划

### 阶段 1：CLI 工具

创建 `@anthropic/mulby-cli` 包：

```
mulby-cli/
├── src/
│   ├── commands/
│   │   ├── create.ts    # 创建插件模板
│   │   ├── build.ts     # 构建插件
│   │   ├── pack.ts      # 打包 .inplugin
│   │   └── dev.ts       # 开发模式
│   └── index.ts
└── templates/
    ├── basic/           # 基础模板
    └── with-ui/         # 带 UI 模板
```

### 阶段 2：容器支持

更新 Mulby 主程序：

1. **PluginInstaller** - 安装 .inplugin 文件
2. **文件关联** - 注册 .inplugin 扩展名
3. **拖拽安装** - 支持拖入窗口安装

---

## 总结

| 问题 | 解决方案 |
|------|---------|
| 第三方库 | esbuild 打包，依赖内联到 main.js |
| 安装不便 | .inplugin 格式，双击/拖拽安装 |
| 开发体验 | CLI 工具 + 模板 + 热重载 |

这个方案的核心是**打包时解决依赖**，而非运行时。插件开发者可以自由使用任何 npm 包，打包工具会将其内联到最终的 JS 文件中。
