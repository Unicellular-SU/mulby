import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'

// 获取 CLI 包的 assets 目录路径
function getAssetsDir(): string {
  return path.resolve(__dirname, '../../assets')
}

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

  // 复制默认图标
  copyDefaultIcon(targetDir)

  // manifest.json
  const manifest = {
    name,
    version: '1.0.0',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    icon: 'icon.png',
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

  // 0. 复制默认图标
  copyDefaultIcon(targetDir)

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
    icon: 'icon.png',
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
  createReactHooks(targetDir)

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
import { useIntools } from './hooks/useIntools'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const { clipboard, notification } = useIntools('${name}')

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
    await clipboard.writeText(result)
    notification.show('已复制到剪贴板')
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

function createReactHooks(targetDir: string) {
  fs.mkdirSync(path.join(targetDir, 'src/ui/hooks'))

  const useIntools = `import { useMemo } from 'react'

export function useIntools(pluginId?: string) {
  return useMemo(() => ({
    clipboard: {
      readText: () => window.intools?.clipboard?.readText(),
      writeText: (text: string) => window.intools?.clipboard?.writeText(text),
      readImage: () => window.intools?.clipboard?.readImage(),
      writeImage: (buffer: ArrayBuffer) => window.intools?.clipboard?.writeImage(buffer),
      readFiles: () => window.intools?.clipboard?.readFiles(),
      getFormat: () => window.intools?.clipboard?.getFormat(),
    },
    storage: {
      get: (key: string) => window.intools?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.intools?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.intools?.storage?.remove(key, pluginId),
    },
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => 
        window.intools?.notification?.show(message, type),
    },
    window: {
      hide: () => window.intools?.window?.hide(),
      setSize: (width: number, height: number) => window.intools?.window?.setSize(width, height),
      center: () => window.intools?.window?.center(),
    },
    
    // Theme API
    theme: {
      get: () => window.intools?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.intools?.theme?.set(mode),
      getActual: () => window.intools?.theme?.getActual(),
    },

    // Screen API
    screen: {
      getAllDisplays: () => window.intools?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.intools?.screen?.getPrimaryDisplay(),
      getDisplayNearestPoint: (point: { x: number; y: number }) => window.intools?.screen?.getDisplayNearestPoint(point),
      getCursorScreenPoint: () => window.intools?.screen?.getCursorScreenPoint(),
      getSources: (options?: any) => window.intools?.screen?.getSources(options),
      capture: (options?: any) => window.intools?.screen?.capture(options),
      captureRegion: (region: any, options?: any) => window.intools?.screen?.captureRegion(region, options),
      getMediaStreamConstraints: (options: any) => window.intools?.screen?.getMediaStreamConstraints(options),
    },

    // Shell API
    shell: {
      openPath: (path: string) => window.intools?.shell?.openPath(path),
      openExternal: (url: string) => window.intools?.shell?.openExternal(url),
      showItemInFolder: (path: string) => window.intools?.shell?.showItemInFolder(path),
      openFolder: (path: string) => window.intools?.shell?.openFolder(path),
      trashItem: (path: string) => window.intools?.shell?.trashItem(path),
      beep: () => window.intools?.shell?.beep(),
    },

    // Filesystem API
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.intools?.filesystem?.exists(path),
      readdir: (path: string) => window.intools?.filesystem?.readdir(path),
      mkdir: (path: string) => window.intools?.filesystem?.mkdir(path),
      stat: (path: string) => window.intools?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.intools?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.intools?.filesystem?.move(src, dest),
      unlink: (path: string) => window.intools?.filesystem?.unlink(path),
    },

    // Dialog API
    dialog: {
      showOpenDialog: (options?: any) => window.intools?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: any) => window.intools?.dialog?.showSaveDialog(options),
      showMessageBox: (options: any) => window.intools?.dialog?.showMessageBox(options),
      showErrorBox: (title: string, content: string) => window.intools?.dialog?.showErrorBox(title, content),
    },

    // System API
    system: {
      getSystemInfo: () => window.intools?.system?.getSystemInfo(),
      getAppInfo: () => window.intools?.system?.getAppInfo(),
      getPath: (name: string) => window.intools?.system?.getPath(name as any),
      getEnv: (name: string) => window.intools?.system?.getEnv(name),
      getIdleTime: () => window.intools?.system?.getIdleTime(),
    },

    // Shortcut API
    shortcut: {
      register: (accelerator: string) => window.intools?.shortcut?.register(accelerator),
      unregister: (accelerator: string) => window.intools?.shortcut?.unregister(accelerator),
      unregisterAll: () => window.intools?.shortcut?.unregisterAll(),
      isRegistered: (accelerator: string) => window.intools?.shortcut?.isRegistered(accelerator),
      onTriggered: (callback: (accelerator: string) => void) => window.intools?.shortcut?.onTriggered(callback),
    },

    // Security API
    security: {
      isEncryptionAvailable: () => window.intools?.security?.isEncryptionAvailable(),
      encryptString: (plainText: string) => window.intools?.security?.encryptString(plainText),
      decryptString: (encrypted: ArrayBuffer) => window.intools?.security?.decryptString(encrypted),
    },

    // Media API
    media: {
      getAccessStatus: (mediaType: 'microphone' | 'camera') => window.intools?.media?.getAccessStatus(mediaType),
      askForAccess: (mediaType: 'microphone' | 'camera') => window.intools?.media?.askForAccess(mediaType),
      hasCameraAccess: () => window.intools?.media?.hasCameraAccess(),
      hasMicrophoneAccess: () => window.intools?.media?.hasMicrophoneAccess(),
    },

    // Power API
    power: {
      getSystemIdleTime: () => window.intools?.power?.getSystemIdleTime(),
      getSystemIdleState: (idleThreshold: number) => window.intools?.power?.getSystemIdleState(idleThreshold),
      isOnBatteryPower: () => window.intools?.power?.isOnBatteryPower(),
      getCurrentThermalState: () => window.intools?.power?.getCurrentThermalState(),
      onSuspend: (callback: () => void) => window.intools?.power?.onSuspend(callback),
      onResume: (callback: () => void) => window.intools?.power?.onResume(callback),
      onAC: (callback: () => void) => window.intools?.power?.onAC(callback),
      onBattery: (callback: () => void) => window.intools?.power?.onBattery(callback),
      onLockScreen: (callback: () => void) => window.intools?.power?.onLockScreen(callback),
      onUnlockScreen: (callback: () => void) => window.intools?.power?.onUnlockScreen(callback),
    },

    // Tray API
    tray: {
      create: (options: any) => window.intools?.tray?.create(options),
      destroy: () => window.intools?.tray?.destroy(),
      setIcon: (icon: string) => window.intools?.tray?.setIcon(icon),
      setTooltip: (tooltip: string) => window.intools?.tray?.setTooltip(tooltip),
      setTitle: (title: string) => window.intools?.tray?.setTitle(title),
      exists: () => window.intools?.tray?.exists(),
    },

    // HTTP API
    http: {
      request: (options: any) => window.intools?.http?.request(options),
      get: (url: string, headers?: Record<string, string>) => window.intools?.http?.get(url, headers),
      post: (url: string, body?: any, headers?: Record<string, string>) => window.intools?.http?.post(url, body, headers),
      put: (url: string, body?: any, headers?: Record<string, string>) => window.intools?.http?.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => window.intools?.http?.delete(url, headers),
    },

    // Network API
    network: {
      isOnline: () => window.intools?.network?.isOnline(),
      onOnline: (callback: () => void) => window.intools?.network?.onOnline(callback),
      onOffline: (callback: () => void) => window.intools?.network?.onOffline(callback),
    },

    // Menu API
    menu: {
      showContextMenu: (items: any[]) => window.intools?.menu?.showContextMenu(items),
    },

    // Geolocation API
    geolocation: {
      getAccessStatus: () => window.intools?.geolocation?.getAccessStatus(),
      requestAccess: () => window.intools?.geolocation?.requestAccess(),
      canGetPosition: () => window.intools?.geolocation?.canGetPosition(),
      openSettings: () => window.intools?.geolocation?.openSettings(),
      getCurrentPosition: () => window.intools?.geolocation?.getCurrentPosition(),
    },

    // TTS API
    tts: {
      speak: (text: string, options?: any) => window.intools?.tts?.speak(text, options),
      stop: () => window.intools?.tts?.stop(),
      pause: () => window.intools?.tts?.pause(),
      resume: () => window.intools?.tts?.resume(),
      getVoices: () => window.intools?.tts?.getVoices(),
      isSpeaking: () => window.intools?.tts?.isSpeaking(),
    },

    // Host API
    host: {
      invoke: (pluginName: string, method: string, ...args: any[]) => window.intools?.host?.invoke(pluginName, method, ...args),
      status: (pluginName: string) => window.intools?.host?.status(pluginName),
      restart: (pluginName: string) => window.intools?.host?.restart(pluginName),
    },
  }), [pluginId])
}
`
  fs.writeFileSync(path.join(targetDir, 'src/ui/hooks/useIntools.ts'), useIntools)
  console.log(chalk.green('  ✓ src/ui/hooks/useIntools.ts'))
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
  detach(): void
  close(): void
  setAlwaysOnTop(flag: boolean): void
  getMode(): Promise<'attached' | 'detached'>
  minimize(): void
  maximize(): void
  getState(): Promise<{ isMaximized: boolean }>
  reload(): void
}

interface IntoolsTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface IntoolsPlugin {
  getAll(): Promise<any[]>
  search(query: string): Promise<any[]>
  run(name: string, featureCode: string, input?: string): Promise<any>
  install(filePath: string): Promise<any>
  enable(name: string): Promise<any>
  disable(name: string): Promise<any>
  uninstall(name: string): Promise<any>
  getReadme(name: string): Promise<string | null>
}

// Screen API 类型
interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
}

interface IntoolsScreen {
  getAllDisplays(): Promise<DisplayInfo[]>
  getPrimaryDisplay(): Promise<DisplayInfo>
  getDisplayNearestPoint(point: { x: number; y: number }): Promise<DisplayInfo>
  getCursorScreenPoint(): Promise<{ x: number; y: number }>
  getSources(options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }): Promise<CaptureSource[]>
  capture(options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  captureRegion(region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  getMediaStreamConstraints(options: { sourceId: string; audio?: boolean; frameRate?: number }): Promise<object>
}

// Shell API 类型
interface IntoolsShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
}

// Dialog API 类型
interface IntoolsDialog {
  showOpenDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
  }): Promise<string[]>
  showSaveDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  showMessageBox(options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }): Promise<{ response: number; checkboxChecked: boolean }>
  showErrorBox(title: string, content: string): Promise<void>
}

// System API 类型
interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  username: string
  homedir: string
  tmpdir: string
  cpus: number
  totalmem: number
  freemem: number
  uptime: number
  osVersion: string
  osRelease: string
}

interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

interface IntoolsSystem {
  getSystemInfo(): Promise<SystemInfo>
  getAppInfo(): Promise<AppInfo>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
}

// GlobalShortcut API 类型
interface IntoolsShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): void
}

// Security API 类型
interface IntoolsSecurity {
  isEncryptionAvailable(): Promise<boolean>
  encryptString(plainText: string): Promise<ArrayBuffer>
  decryptString(encrypted: ArrayBuffer): Promise<string>
}

// Media API 类型
interface IntoolsMedia {
  getAccessStatus(mediaType: 'microphone' | 'camera'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
  hasCameraAccess(): Promise<boolean>
  hasMicrophoneAccess(): Promise<boolean>
}

// Power API 类型
interface IntoolsPower {
  getSystemIdleTime(): Promise<number>
  getSystemIdleState(idleThreshold: number): Promise<'active' | 'idle' | 'locked' | 'unknown'>
  isOnBatteryPower(): Promise<boolean>
  getCurrentThermalState(): Promise<'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'>
  onSuspend(callback: () => void): void
  onResume(callback: () => void): void
  onAC(callback: () => void): void
  onBattery(callback: () => void): void
  onLockScreen(callback: () => void): void
  onUnlockScreen(callback: () => void): void
}

// Tray API 类型
interface IntoolsTray {
  create(options: { icon: string; tooltip?: string; title?: string }): Promise<boolean>
  destroy(): Promise<void>
  setIcon(icon: string): Promise<void>
  setTooltip(tooltip: string): Promise<void>
  setTitle(title: string): Promise<void>
  exists(): Promise<boolean>
}

// Network API 类型
interface IntoolsNetwork {
  isOnline(): Promise<boolean>
  onOnline(callback: () => void): void
  onOffline(callback: () => void): void
}

// Menu API 类型
interface IntoolsMenu {
  showContextMenu(items: {
    label: string
    type?: 'normal' | 'separator' | 'checkbox' | 'radio'
    checked?: boolean
    enabled?: boolean
    id?: string
    submenu?: any[]
  }[]): Promise<string | null>
}

// Geolocation API 类型
interface IntoolsGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  getCurrentPosition(): Promise<{
    latitude: number
    longitude: number
    accuracy: number
    altitude?: number | null
    altitudeAccuracy?: number | null
    heading?: number | null
    speed?: number | null
    timestamp: number
  }>
}

// TTS API 类型
interface IntoolsTTS {
  speak(text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  getVoices(): { name: string; lang: string; default: boolean; localService: boolean }[]
  isSpeaking(): boolean
}

// Plugin Host API 类型
interface IntoolsHost {
  invoke(pluginName: string, method: string, ...args: unknown[]): Promise<any>
  status(pluginName: string): Promise<any>
  restart(pluginName: string): Promise<void>
}

// Storage API 类型
interface IntoolsStorage {
  get(key: string, namespace?: string): Promise<unknown>
  set(key: string, value: unknown, namespace?: string): Promise<void>
  remove(key: string, namespace?: string): Promise<void>
  getAll(namespace?: string): Promise<Record<string, unknown>>
  clear(namespace?: string): Promise<boolean>
}

// HTTP API 类型
interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

interface IntoolsHttp {
  request(options: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
    headers?: Record<string, string>
    body?: unknown
    timeout?: number
  }): Promise<HttpResponse>
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>
  post(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  put(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  delete(url: string, headers?: Record<string, string>): Promise<HttpResponse>
}

// Filesystem API 类型
interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

interface IntoolsFilesystem {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | ArrayBuffer>
  writeFile(path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64'): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  stat(path: string): Promise<FileStat | null>
  copy(src: string, dest: string): Promise<void>
  move(src: string, dest: string): Promise<void>
  extname(path: string): string
  dirname(path: string): string
  basename(path: string, ext?: string): string
  join(...paths: string[]): string
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
  theme?: IntoolsTheme
  screen: IntoolsScreen
  shell: IntoolsShell
  dialog: IntoolsDialog
  system: IntoolsSystem
  shortcut: IntoolsShortcut
  security: IntoolsSecurity
  media: IntoolsMedia
  power: IntoolsPower
  tray: IntoolsTray
  network: IntoolsNetwork
  menu: IntoolsMenu
  geolocation: IntoolsGeolocation
  tts: IntoolsTTS
  host: IntoolsHost
  storage: IntoolsStorage
  http: IntoolsHttp
  filesystem: IntoolsFilesystem
  onPluginInit(callback: (data: PluginInitData) => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
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

// ============================================
// 复制默认图标
// ============================================
function copyDefaultIcon(targetDir: string) {
  const defaultIconPath = path.join(getAssetsDir(), 'default-icon.png')
  const targetIconPath = path.join(targetDir, 'icon.png')

  if (fs.existsSync(defaultIconPath)) {
    fs.copyFileSync(defaultIconPath, targetIconPath)
    console.log(chalk.green('  ✓ icon.png'))
  }
}
