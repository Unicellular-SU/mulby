import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'

interface CreateOptions {
  template: 'react' | 'basic'
}

export async function create(name: string, options: CreateOptions) {
  const targetDir = path.resolve(process.cwd(), name)

  if (fs.existsSync(targetDir)) {
    console.log(chalk.red(`错误: 目录 ${name} 已存在`))
    process.exit(1)
  }

  const template = options.template || 'react'

  console.log(chalk.blue(`创建插件项目: ${name}`))
  console.log(chalk.gray(`模板: ${template}`))
  console.log()

  if (template === 'react') {
    await createReactProject(targetDir, name)
  } else {
    await createBasicProject(targetDir, name)
  }

  console.log()
  console.log(chalk.green('插件创建成功!'))
  console.log()
  console.log('下一步:')
  console.log(chalk.cyan(`  cd ${name}`))
  console.log(chalk.cyan('  npm install'))
  console.log(chalk.cyan('  npm run dev'))
}

// ============================================
// 基础插件模板（无 UI）
// ============================================
async function createBasicProject(targetDir: string, name: string) {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))

  // manifest.json
  const manifest = {
    name,
    version: '1.0.0',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    features: [
      {
        code: 'main',
        explain: '主功能',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }
  fs.writeJsonSync(path.join(targetDir, 'manifest.json'), manifest, { spaces: 2 })
  console.log(chalk.green('  ✓ manifest.json'))

  // package.json
  const pkg = {
    name,
    version: '1.0.0',
    scripts: {
      build: 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      dev: 'intools dev',
      pack: 'intools pack'
    },
    devDependencies: {
      esbuild: '^0.20.0',
      typescript: '^5.0.0'
    }
  }
  fs.writeJsonSync(path.join(targetDir, 'package.json'), pkg, { spaces: 2 })
  console.log(chalk.green('  ✓ package.json'))

  // src/main.ts
  const mainTs = `module.exports = {
  async run(context: any) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()

    // 在这里实现你的逻辑
    const result = text.toUpperCase()

    await clipboard.writeText(result)
    notification.show('处理完成')
  }
}
`
  fs.writeFileSync(path.join(targetDir, 'src/main.ts'), mainTs)
  console.log(chalk.green('  ✓ src/main.ts'))
}

// ============================================
// React 插件模板（默认）
// ============================================
async function createReactProject(targetDir: string, name: string) {
  // 创建目录结构
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))
  fs.mkdirSync(path.join(targetDir, 'src/ui'))

  // 1. manifest.json
  createReactManifest(targetDir, name)

  // 2. package.json
  createReactPackageJson(targetDir, name)

  // 3. tsconfig.json
  createTsConfig(targetDir)

  // 4. vite.config.ts
  createViteConfig(targetDir)

  // 5. src/main.ts (后端逻辑)
  createBackendMain(targetDir)

  // 6. src/ui/* (React UI)
  createReactUI(targetDir, name)

  // 7. src/types/intools.d.ts (类型定义)
  createIntoolsTypes(targetDir)
}

function createReactManifest(targetDir: string, name: string) {
  const manifest = {
    name,
    version: '1.0.0',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    ui: 'ui/index.html',
    features: [
      {
        code: 'main',
        explain: '主功能',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }
  fs.writeJsonSync(path.join(targetDir, 'manifest.json'), manifest, { spaces: 2 })
  console.log(chalk.green('  ✓ manifest.json'))
}

function createReactPackageJson(targetDir: string, name: string) {
  const pkg = {
    name,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'intools dev',
      build: 'npm run build:backend && npm run build:ui',
      'build:backend': 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      'build:ui': 'vite build',
      pack: 'intools pack'
    },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0'
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      '@vitejs/plugin-react': '^4.2.0',
      esbuild: '^0.20.0',
      typescript: '^5.3.0',
      vite: '^5.0.0'
    }
  }
  fs.writeJsonSync(path.join(targetDir, 'package.json'), pkg, { spaces: 2 })
  console.log(chalk.green('  ✓ package.json'))
}

function createTsConfig(targetDir: string) {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true
    },
    include: ['src']
  }
  fs.writeJsonSync(path.join(targetDir, 'tsconfig.json'), tsconfig, { spaces: 2 })
  console.log(chalk.green('  ✓ tsconfig.json'))
}

function createViteConfig(targetDir: string) {
  const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  build: {
    outDir: '../../ui',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
`
  fs.writeFileSync(path.join(targetDir, 'vite.config.ts'), viteConfig)
  console.log(chalk.green('  ✓ vite.config.ts'))
}

function createBackendMain(targetDir: string) {
  const mainTs = `// 后端逻辑 - 在沙箱中运行
// 如果插件有 UI，此文件可以为空或用于后台任务

module.exports = {
  // 插件加载时调用
  onLoad() {
    console.log('插件已加载')
  },

  // 插件卸载时调用
  onUnload() {
    console.log('插件已卸载')
  },

  // 主执行函数（无 UI 时使用）
  async run(context: any) {
    const { notification } = context.api
    notification.show('插件已启动')
  }
}
`
  fs.writeFileSync(path.join(targetDir, 'src/main.ts'), mainTs)
  console.log(chalk.green('  ✓ src/main.ts'))
}

function createReactUI(targetDir: string, name: string) {
  // index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
`
  fs.writeFileSync(path.join(targetDir, 'src/ui/index.html'), indexHtml)
  console.log(chalk.green('  ✓ src/ui/index.html'))

  // main.tsx
  const mainTsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`
  fs.writeFileSync(path.join(targetDir, 'src/ui/main.tsx'), mainTsx)
  console.log(chalk.green('  ✓ src/ui/main.tsx'))

  // App.tsx
  const appTsx = `import { useEffect, useState } from 'react'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  useEffect(() => {
    // 接收插件初始化数据
    window.intools?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        setInput(data.input)
      }
    })
  }, [])

  const handleProcess = async () => {
    // 示例：将输入转为大写
    const result = input.toUpperCase()
    setOutput(result)

    // 复制到剪贴板并通知
    await window.intools?.clipboard?.writeText(result)
    window.intools?.notification?.show('已复制到剪贴板')
  }

  return (
    <div className="app">
      <div className="titlebar">${name}</div>
      <div className="container">
        <div className="field">
          <label>输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请输入内容..."
          />
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={handleProcess}>
            处理
          </button>
        </div>
        <div className="field">
          <label>输出</label>
          <textarea
            value={output}
            readOnly
            placeholder="结果将显示在这里..."
          />
        </div>
      </div>
    </div>
  )
}
`
  fs.writeFileSync(path.join(targetDir, 'src/ui/App.tsx'), appTsx)
  console.log(chalk.green('  ✓ src/ui/App.tsx'))

  // styles.css
  const stylesCss = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #1e1e1e;
  color: #e0e0e0;
  min-height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.titlebar {
  height: 32px;
  background: #2d2d2d;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #999;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.container {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.field label {
  font-size: 12px;
  color: #999;
}

.field textarea {
  flex: 1;
  background: #2d2d2d;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
  padding: 12px;
  color: #fff;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  resize: none;
  outline: none;
  min-height: 80px;
}

.field textarea:focus {
  border-color: #0078d4;
}

.field textarea::placeholder {
  color: #666;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

button {
  padding: 8px 24px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary {
  background: #0078d4;
  color: #fff;
}

.btn-primary:hover {
  background: #1084d8;
}

.btn-secondary {
  background: #3d3d3d;
  color: #fff;
}

.btn-secondary:hover {
  background: #4d4d4d;
}
`
  fs.writeFileSync(path.join(targetDir, 'src/ui/styles.css'), stylesCss)
  console.log(chalk.green('  ✓ src/ui/styles.css'))
}

function createIntoolsTypes(targetDir: string) {
  fs.mkdirSync(path.join(targetDir, 'src/types'))

  const typesDts = `// InTools API 类型定义

interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

interface IntoolsClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  readImage(): Promise<ArrayBuffer | null>
  writeImage(buffer: ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface IntoolsNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface IntoolsWindow {
  hide(): void
  setSize(width: number, height: number): void
  center(): void
}

interface IntoolsPlugin {
  getAll(): Promise<any[]>
  search(query: string): Promise<any[]>
  run(name: string, featureCode: string, input?: string): Promise<any>
  install(filePath: string): Promise<any>
  enable(name: string): Promise<any>
  disable(name: string): Promise<any>
  uninstall(name: string): Promise<any>
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

interface IntoolsAPI {
  clipboard: IntoolsClipboard
  notification: IntoolsNotification
  window: IntoolsWindow
  plugin: IntoolsPlugin
  onPluginInit(callback: (data: PluginInitData) => void): void
}

declare global {
  interface Window {
    intools: IntoolsAPI
  }
}

export {}
`
  fs.writeFileSync(path.join(targetDir, 'src/types/intools.d.ts'), typesDts)
  console.log(chalk.green('  ✓ src/types/intools.d.ts'))
}
