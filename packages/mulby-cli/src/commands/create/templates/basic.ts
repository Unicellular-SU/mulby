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

type PluginContext = BackendPluginContext

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

export async function run(context: PluginContext) {
  const { clipboard, notification } = context.api
  const text = context.input || await clipboard.readText()
  const result = text.toUpperCase()

  await clipboard.writeText(result)
  await notification.show('Done')
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

### Install dependencies

\`\`\`bash
npm install
\`\`\`

### Start development mode

\`\`\`bash
npm run dev
\`\`\`

### Build

\`\`\`bash
npm run build
\`\`\`

### Package

\`\`\`bash
npm run pack
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
