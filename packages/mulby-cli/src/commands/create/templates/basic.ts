export function buildBasicManifest(name: string) {
  return {
    id: name,
    name,
    version: '1.0.0',
    displayName: name,
    author: 'mulby',
    description: 'Plugin description',
    main: 'dist/main.js',
    icon: 'icon.png',
    features: [
      {
        code: 'main',
        explain: 'Main feature',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }
}

export function buildBasicPackageJson(name: string) {
  return {
    name,
    version: '1.0.0',
    packageManager: 'pnpm@9.1.0',
    scripts: {
      build: 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      dev: 'mulby dev',
      pack: 'mulby pack'
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      esbuild: '^0.20.0',
      typescript: '^5.0.0'
    }
  }
}

export function buildBasicMain(name: string) {
  return `/// <reference path="./types/mulby.d.ts" />
// 运行时由 Mulby 宿主注入全局 API 代理（无需从参数中获取）
declare const mulby: any

export function onLoad() {
  console.log('[${name}] plugin loaded')
}

export function onUnload() {
  console.log('[${name}] plugin unloaded')
}

export function onEnable() {
  console.log('[${name}] plugin enabled')
}

export function onDisable() {
  console.log('[${name}] plugin disabled')
}

export async function run(context: BackendPluginContext) {
  const text = context.input || await mulby.clipboard.readText()
  const result = text.toUpperCase()

  await mulby.clipboard.writeText(result)
  mulby.notification.show('Done')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
`
}

export function buildGitignore() {
  return `node_modules
dist
.DS_Store
*.log
`
}

export function buildBasicReadme(name: string) {
  return `# ${name}

Plugin description

## Features

- Feature 1
- Feature 2
- Feature 3

## Trigger

- \`${name}\` - main feature

## Development

> **💡 提示**: 推荐使用 [pnpm](https://pnpm.io/) 进行依赖管理。若插件放置于基于 pnpm workspace 的父仓库（如 \`plugins/<name>/\` 目录），通常建议直接在**仓库根目录**执行一次 \`pnpm install\`。也可以在当前插件目录单独执行。

### Install dependencies

\`\`\`bash
pnpm install
\`\`\`

### Start development mode

\`\`\`bash
pnpm run dev
\`\`\`

### Build

\`\`\`bash
pnpm run build
\`\`\`

### Package

\`\`\`bash
pnpm run pack
\`\`\`

## Project structure

\`\`\`
${name}/
|-- manifest.json
|-- package.json
|-- src/
|   |-- main.ts
|   |-- types/
|       |-- mulby.d.ts
|-- dist/
|-- icon.png
\`\`\`

## License

MIT License
`
}
