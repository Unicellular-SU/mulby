# Mulby CLI

Mulby 插件开发命令行工具，用来创建、调试、构建、打包，以及通过 AI 辅助开发插件。

## 功能概览

- 快速创建 `react` 或 `basic` 模板插件
- 开发模式下自动重建，React 模板支持 Vite UI 开发
- 构建并打包为 `.inplugin`
- `mulby create --ai` 支持 AI 辅助生成和迭代插件
- AI 开发内置两个 skill:
  - `develop-mulby-plugin`
  - `generate-electron-icons`

## 安装

```bash
npm install -g mulby-cli
```

也可以在插件项目里作为开发依赖安装：

```bash
pnpm add -D mulby-cli
```

## 快速开始

### 手动开发

```bash
mulby create my-plugin
cd my-plugin
pnpm install
pnpm run dev
```

开发完成后：

```bash
pnpm run build
pnpm run pack
```

打包结果为 `my-plugin-<version>.inplugin`。

### AI 辅助开发

先配置 AI 提供商：

```bash
mulby ai setup
```

然后创建插件：

```bash
mulby create my-plugin --ai --desc "描述插件要做什么"
```

如果中途中断，可以在插件目录中恢复会话：

```bash
mulby resume
```

## 核心命令

| 命令 | 说明 |
|------|------|
| `mulby create <name>` | 创建插件项目 |
| `mulby create <name> --template basic` | 创建无 UI 插件 |
| `mulby create <name> --ai --desc "..."` | 使用 AI 辅助开发插件 |
| `mulby dev` | 开发模式，监听构建 |
| `mulby build` | 构建插件 |
| `mulby pack` | 打包为 `.inplugin` |
| `mulby resume` | 恢复当前目录的 AI 会话 |
| `mulby ai setup` | 快速配置默认 AI 提供商 |
| `mulby ai list` | 查看 AI 配置 |
| `mulby --help` | 查看完整命令帮助 |

## 项目模板

### React 模板

适合有界面的插件，默认生成：

```text
my-plugin/
├── manifest.json
├── package.json
├── icon.png
├── src/
│   ├── main.ts
│   ├── types/mulby.d.ts
│   └── ui/
│       ├── App.tsx
│       ├── main.tsx
│       └── index.html
├── dist/
└── ui/
```

### Basic 模板

适合无界面的后台型插件：

```text
my-plugin/
├── manifest.json
├── package.json
├── icon.png
└── src/
    └── main.ts
```

## `manifest.json` 最小示例

```json
{
  "id": "my-plugin",
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "我的插件",
  "description": "插件功能描述",
  "main": "dist/main.js",
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

常见字段：

- `ui`: React 或其他前端界面入口，例如 `ui/index.html`
- `type`: 插件类型，例如 `utility`、`developer`、`ai`
- `pluginSetting`: 插件窗口行为，例如 `single`、`height`
- `window`: 独立窗口尺寸配置

## AI 开发与内置 Skill

`mulby-cli` 发布到 npm 后，AI 开发仍然可以直接使用内置 skill，不需要用户额外安装。

默认内置：

- `develop-mulby-plugin`
  - 负责插件架构、模板选择、API 文档导航、开发闭环、验证与打包
- `generate-electron-icons`
  - 负责从 SVG 生成最终图标资源

AI 开发时的默认策略：

1. 先使用 `develop-mulby-plugin` 规划和实现插件。
2. 插件功能和 UI 主题稳定后，再生成符合主题的 `icon.svg`。
3. 使用 `generate-electron-icons` 将 SVG 转成最终 `512x512` 的 `icon.png`。
4. 用生成的 `icon.png` 替换模板默认图标，再执行 `mulby pack`。

这意味着：

- 不再依赖旧的 `PLUGIN_DEVELOP_PROMPT.md`
- `mulby-cli` 内部 AI 使用 bundled skills 作为主知识来源
- 维护时只需要持续完善 repo 根目录下的 skill 内容

## 构建与打包

开发时：

```bash
pnpm run dev
```

生产构建：

```bash
pnpm run build
```

打包：

```bash
pnpm run pack
```

注意：

- `pack` 前请先执行 `build`
- 插件根目录下的 `icon.png` 会被一起打进包里
- 如果是 React 插件，确保 `ui/` 构建产物已经生成

## 深度文档在哪里

README 只保留高频入口。更完整的 Mulby 插件开发知识已经放进内置 skill。

如果你在维护仓库源码，source of truth 在：

- `skills/develop-mulby-plugin`
- `skills/generate-electron-icons`

如果你是在 `mulby-cli` 的 AI 会话里工作，优先阅读：

- `@skills/develop-mulby-plugin/SKILL.md`
- `@skills/develop-mulby-plugin/references/plugin-development-guide.md`
- `@skills/develop-mulby-plugin/references/apis/README.md`
- `@skills/generate-electron-icons/SKILL.md`

## 常见问题

### `mulby create` 之后还需要做什么？

进入插件目录，安装依赖，然后运行 `pnpm run dev`。

### `mulby pack` 会自动构建吗？

不会。请先运行 `mulby build` 或 `pnpm run build`。

### AI 开发为什么不再生成 `PLUGIN_DEVELOP_PROMPT.md`？

因为现在 `mulby-cli` 已内置 `develop-mulby-plugin` 和 `generate-electron-icons` 两个 skill，AI 会直接从 bundled skills 读取工作流和参考资料。

### 还可以查看更完整的命令帮助吗？

可以：

```bash
mulby --help
mulby ai --help
```
