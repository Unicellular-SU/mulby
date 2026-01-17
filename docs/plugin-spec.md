# InTools 插件开发规范

本文档描述当前版本 InTools 的插件开发规范，内容以实际代码、CLI 和官方文档为准。

## 快速开始

使用 CLI 创建、开发与打包插件：

```bash
npm install -g intools-cli

intools create my-plugin
cd my-plugin
npm install
npm run dev
npm run build
npm run pack
```

创建无 UI 插件（basic 模板）：

```bash
intools create my-plugin --template basic
```

CLI 行为与完整命令说明见 `packages/intools-cli/README.md`。

## 项目结构

### React 插件（默认模板）

```
my-plugin/
├── package.json
├── manifest.json
├── tsconfig.json
├── vite.config.ts
├── icon.png
├── src/
│   ├── main.ts
│   ├── types/
│   │   └── intools.d.ts
│   └── ui/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── hooks/
│       │   └── useIntools.ts
│       └── styles.css
├── dist/
│   └── main.js
└── ui/
    ├── index.html
    └── assets/
```

### 基础插件（无 UI 模板）

```
my-plugin/
├── package.json
├── manifest.json
├── icon.png
└── src/
    └── main.ts
```

模板输出由 CLI 生成（见 `packages/intools-cli/src/commands/create/templates/*`）。

## manifest.json

manifest 规范请以 `docs/manifest-v2.md` 为准。本节仅补充与实际加载行为相关的关键点：

- 必填字段（由加载器校验）：`name`, `version`, `displayName`, `main`, `features`。
- `id` 可选且推荐；若未提供，插件 ID 取 `name`。
- `icon` 未设置时会尝试加载插件目录下的 `icon.png`。
- `author` / `homepage` 为可选元信息，用于插件管理展示。

功能入口 `features` 与 `cmds` 类型说明请参考 `docs/manifest-v2.md`。

## 插件生命周期与执行入口

插件后端导出以下可选钩子与执行入口：

- `onLoad` / `onUnload`
- `onEnable` / `onDisable`
- `run`

`run(context)` 的 `context` 结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `api` | object | 插件 API 入口（按功能拆分，见下方） |
| `featureCode` | string | 触发的功能入口 code |
| `input` | string | 触发时的文本输入 |
| `attachments` | array | 文件/图片附件列表（可选） |

`attachments` 的结构参见 `src/shared/types/plugin.ts`。

## UI 初始化事件

UI 插件在窗口加载后，会收到初始化事件：

```ts
window.intools.onPluginInit((data) => {
  // data: { pluginName, featureCode, input, attachments?, mode?, route? }
})
```

- `route` 来自 feature 的 `route` 配置（或辅助窗口创建时的路由）。
- `attachments` 与 `run(context)` 中一致，便于 UI 直接处理粘贴/拖拽输入。

## API 说明

所有 API 都在 `docs/apis` 中分文件维护，请按类别查阅：

- 入口索引：`docs/apis/README.md`
- 动态指令（runtime features）：`docs/apis/features.md`

## 构建与打包

- `npm run build` 输出：
  - 后端：`dist/main.js`
  - UI：`ui/`（由 Vite 产出）
- `npm run pack` 生成 `.inplugin` 安装包

构建/打包流程以 CLI 为准（`packages/intools-cli/README.md`）。
