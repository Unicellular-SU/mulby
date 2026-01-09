import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'

interface CreateOptions {
  template: string
  ui?: 'html' | 'react'
}

export async function create(name: string, options: CreateOptions) {
  const targetDir = path.resolve(process.cwd(), name)

  if (fs.existsSync(targetDir)) {
    console.log(chalk.red(`错误: 目录 ${name} 已存在`))
    process.exit(1)
  }

  console.log(chalk.blue(`创建插件项目: ${name}`))

  // 创建目录
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))

  const hasUI = !!options.ui

  // 生成 manifest.json
  const manifest: Record<string, unknown> = {
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

  if (hasUI) {
    manifest.ui = 'ui/index.html'
  }

  fs.writeJsonSync(
    path.join(targetDir, 'manifest.json'),
    manifest,
    { spaces: 2 }
  )

  console.log(chalk.green('  ✓ manifest.json'))

  // 生成 package.json
  const pkg: Record<string, unknown> = {
    name,
    version: '1.0.0',
    scripts: {
      build: 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      pack: 'intools pack'
    },
    devDependencies: {
      esbuild: '^0.20.0',
      typescript: '^5.0.0'
    }
  }

  // React UI 需要额外依赖
  if (options.ui === 'react') {
    pkg.scripts = {
      ...(pkg.scripts as object),
      'build:ui': 'vite build --config vite.ui.config.ts',
      'build': 'npm run build:ui && esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js'
    }
    pkg.devDependencies = {
      ...(pkg.devDependencies as object),
      'react': '^18.2.0',
      'react-dom': '^18.2.0',
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      'vite': '^5.0.0',
      '@vitejs/plugin-react': '^4.0.0'
    }
  }

  fs.writeJsonSync(
    path.join(targetDir, 'package.json'),
    pkg,
    { spaces: 2 }
  )

  console.log(chalk.green('  ✓ package.json'))

  // 生成 src/main.ts
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

  // 生成 UI 文件
  if (options.ui === 'html') {
    createHtmlUI(targetDir, name)
  } else if (options.ui === 'react') {
    createReactUI(targetDir, name)
  }

  console.log()
  console.log(chalk.green('插件创建成功!'))
  console.log()
  console.log('下一步:')
  console.log(chalk.cyan(`  cd ${name}`))
  console.log(chalk.cyan('  npm install'))
  console.log(chalk.cyan('  npm run build'))
}

function createHtmlUI(targetDir: string, name: string) {
  fs.mkdirSync(path.join(targetDir, 'ui'))

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #fff;
      height: 100vh;
      padding: 16px;
    }
    .titlebar {
      height: 32px;
      background: #2d2d2d;
      -webkit-app-region: drag;
      margin: -16px -16px 16px -16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="titlebar">${name}</div>
  <div id="app"></div>
  <script>
    // 接收初始化数据
    window.intools?.onPluginInit?.((data) => {
      console.log('Plugin init:', data);
    });

    // 调用主程序 API
    // window.intools.clipboard.writeText('text');
    // window.intools.notification.show('message');
  </script>
</body>
</html>`

  fs.writeFileSync(path.join(targetDir, 'ui/index.html'), html)
  console.log(chalk.green('  ✓ ui/index.html'))
}

function createReactUI(targetDir: string, name: string) {
  fs.mkdirSync(path.join(targetDir, 'ui'))
  fs.mkdirSync(path.join(targetDir, 'ui-src'))

  // vite.ui.config.ts
  const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'ui-src',
  build: {
    outDir: '../ui',
    emptyOutDir: true
  }
})
`
  fs.writeFileSync(path.join(targetDir, 'vite.ui.config.ts'), viteConfig)
  console.log(chalk.green('  ✓ vite.ui.config.ts'))

  // ui-src/index.html
  const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>`
  fs.writeFileSync(path.join(targetDir, 'ui-src/index.html'), indexHtml)
  console.log(chalk.green('  ✓ ui-src/index.html'))

  // ui-src/main.tsx
  const mainTsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
`
  fs.writeFileSync(path.join(targetDir, 'ui-src/main.tsx'), mainTsx)
  console.log(chalk.green('  ✓ ui-src/main.tsx'))

  // ui-src/App.tsx
  const appTsx = `import React, { useEffect, useState } from 'react'

declare global {
  interface Window {
    electronAPI: {
      clipboard: { writeText: (t: string) => Promise<void> }
      notification: { show: (msg: string, type?: string) => void }
      onPluginInit: (cb: (data: any) => void) => void
    }
  }
}

export default function App() {
  const [input, setInput] = useState('')

  useEffect(() => {
    window.intools?.onPluginInit?.((data) => {
      if (data.input) setInput(data.input)
    })
  }, [])

  const handleCopy = async () => {
    await window.intools?.clipboard?.writeText(input)
    window.intools?.notification?.show('已复制到剪贴板')
  }

  return (
    <div style={{ padding: 16, background: '#1e1e1e', color: '#fff', minHeight: '100vh' }}>
      <div style={{ marginBottom: 16 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: '100%', height: 100, background: '#2d2d2d', color: '#fff', border: '1px solid #3d3d3d', borderRadius: 4, padding: 8 }}
        />
      </div>
      <button onClick={handleCopy} style={{ padding: '8px 16px', background: '#0078d4', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        复制
      </button>
    </div>
  )
}
`
  fs.writeFileSync(path.join(targetDir, 'ui-src/App.tsx'), appTsx)
  console.log(chalk.green('  ✓ ui-src/App.tsx'))
}
