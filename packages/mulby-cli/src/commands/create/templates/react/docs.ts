/**
 * React 插件模板 - 文档生成器
 * 包含：README.md
 */

/**
 * 生成 README.md 内容
 */
export function buildReactReadme(name: string) {
    return `# ${name}

插件描述

## 功能特性

- 功能 1
- 功能 2
- 功能 3

## 触发方式

- \`${name}\` - 主功能

## 开发

> **💡 提示**: 推荐使用 [pnpm](https://pnpm.io/) 进行依赖管理。若插件放置于基于 pnpm workspace 的父仓库（如 \`plugins/<name>/\` 目录），通常建议直接在**仓库根目录**执行一次 \`pnpm install\`。也可以在当前插件目录单独执行。

### 安装依赖

\`\`\`bash
pnpm install
\`\`\`

### 开发模式

\`\`\`bash
pnpm run dev
\`\`\`

### 构建

\`\`\`bash
pnpm run build
\`\`\`

### 打包

\`\`\`bash
pnpm run pack
\`\`\`

## 项目结构

\`\`\`
${name}/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   ├── ui/
│   │   ├── App.tsx            # 主应用
│   │   ├── main.tsx           # UI 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 全局样式
│   │   ├── hooks/
│   │   │   └── useMulby.ts  # Mulby API Hook
│   └── types/
│       └── mulby.d.ts       # 类型定义（含 BackendPluginContext）
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
└── icon.png                   # 插件图标
\`\`\`

## 许可证

MIT License
`
}
