export function buildReactManifest(name: string) {
  return {
    id: name,
    name,
    version: '1.0.0',
    author: 'intools',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    ui: 'ui/index.html',
    icon: 'icon.png',
    // 独立窗口配置（可选）
    // window: {
    //   width: 800,       // 默认宽度
    //   height: 600,      // 默认高度
    //   minWidth: 400,    // 最小宽度
    //   minHeight: 300,   // 最小高度
    //   maxWidth: 1200,   // 最大宽度
    //   maxHeight: 900    // 最大高度
    // },
    features: [
      {
        code: 'main',
        explain: '主功能',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }
}

export function buildReactPackageJson(name: string) {
  return {
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
}

export function buildTsConfig() {
  return {
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
}

export function buildViteConfig() {
  return `import { defineConfig } from 'vite'
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
}

export function buildBackendMain(name: string) {
  return `interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    notification: {
      show: (message: string, type?: string) => void
    }
    features?: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
        mode?: 'ui' | 'silent' | 'detached'
        route?: string
        mainHide?: boolean
        mainPush?: boolean
        cmds: Array<
          | string
          | { type: 'keyword'; value: string; explain?: string }
          | { type: 'regex'; match: string; explain?: string; label?: string; minLength?: number; maxLength?: number }
          | { type: 'files'; exts?: string[]; fileType?: 'file' | 'directory' | 'any'; match?: string; minLength?: number; maxLength?: number }
          | { type: 'img'; exts?: string[] }
          | { type: 'over'; label?: string; exclude?: string; minLength?: number; maxLength?: number }
        >
      }) => void
      removeFeature: (code: string) => boolean
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
      redirectAiModelsSetting: () => void
    }
  }
  input?: string
  featureCode?: string
}

export function onLoad() {
  console.log('[${name}] 插件已加载')
}

export function onUnload() {
  console.log('[${name}] 插件已卸载')
}

export function onEnable() {
  console.log('[${name}] 插件已启用')
}

export function onDisable() {
  console.log('[${name}] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('插件已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
`
}

export function buildIndexHtml(name: string) {
  return `<!DOCTYPE html>
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
}

export function buildMainTsx() {
  return `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`
}

export function buildAppTsx(name: string) {
  return `import { useEffect, useState } from 'react'
import { useIntools } from './hooks/useIntools'

// 附件类型定义
interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: Attachment[]
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const { clipboard, notification } = useIntools('${name}')

  useEffect(() => {
    // 获取初始主题（从 URL 参数）
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.intools?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.intools?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        setInput(data.input)
      }
      // 接收附件数据
      if (data.attachments) {
        setAttachments(data.attachments)
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

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return \`\${bytes} B\`
    if (bytes < 1024 * 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`
    return \`\${(bytes / 1024 / 1024).toFixed(1)} MB\`
  }

  return (
    <div className="app">
      <div className="titlebar">${name}</div>
      <div className="container">
        {/* 附件展示区域 */}
        {attachments.length > 0 && (
          <div className="field">
            <label>附件 ({attachments.length})</label>
            <div className="attachments-list">
              {attachments.map((item, index) => (
                <div key={item.id || index} className="attachment-item">
                  <span className="attachment-icon">
                    {item.kind === 'image' ? '🖼️' : '📄'}
                  </span>
                  <div className="attachment-info">
                    <div className="attachment-name">{item.name}</div>
                    <div className="attachment-meta">{formatSize(item.size)}</div>
                  </div>
                  {item.kind === 'image' && (item.dataUrl || item.path) && (
                    <img
                      src={item.dataUrl || \`file://\${item.path}\`}
                      alt={item.name}
                      className="attachment-preview"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
}


export function buildStylesCss() {
  return `/* CSS 变量 - 亮色主题 */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #ebebeb;
  --text-primary: #1e1e1e;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --border-color: #e0e0e0;
  --accent-color: #0078d4;
  --accent-hover: #1084d8;
}

/* CSS 变量 - 暗色主题 */
:root.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d2d;
  --bg-tertiary: #3d3d3d;
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --text-tertiary: #666666;
  --border-color: #3d3d3d;
  --accent-color: #0078d4;
  --accent-hover: #1084d8;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  transition: background-color 0.2s, color 0.2s;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.titlebar {
  height: 32px;
  background: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-secondary);
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
  color: var(--text-secondary);
}

.field textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  color: var(--text-primary);
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  resize: none;
  outline: none;
  min-height: 80px;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}

.field textarea:focus {
  border-color: var(--accent-color);
}

.field textarea::placeholder {
  color: var(--text-tertiary);
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
  background: var(--accent-color);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-secondary);
}

/* 附件列表样式 */
.attachments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.attachment-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  gap: 10px;
}

.attachment-icon {
  font-size: 20px;
}

.attachment-info {
  flex: 1;
  min-width: 0;
}

.attachment-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.attachment-preview {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}
`
}

export function buildUseIntools() {
  return `import { useMemo } from 'react'

export function useIntools(pluginId?: string) {
  return useMemo(() => ({
    // Clipboard API
    clipboard: {
      readText: () => window.intools?.clipboard?.readText(),
      writeText: (text: string) => window.intools?.clipboard?.writeText(text),
      readImage: () => window.intools?.clipboard?.readImage(),
      writeImage: (image: string | ArrayBuffer) => window.intools?.clipboard?.writeImage(image),
      readFiles: () => window.intools?.clipboard?.readFiles(),
      writeFiles: (files: string | string[]) => window.intools?.clipboard?.writeFiles(files),
      getFormat: () => window.intools?.clipboard?.getFormat(),
    },

    // Input API
    input: {
      hideMainWindowPasteText: (text: string) => window.intools?.input?.hideMainWindowPasteText(text),
      hideMainWindowPasteImage: (image: string | ArrayBuffer) => window.intools?.input?.hideMainWindowPasteImage(image),
      hideMainWindowPasteFile: (filePaths: string | string[]) => window.intools?.input?.hideMainWindowPasteFile(filePaths),
      hideMainWindowTypeString: (text: string) => window.intools?.input?.hideMainWindowTypeString(text),
      simulateKeyboardTap: (key: string, ...modifiers: string[]) =>
        window.intools?.input?.simulateKeyboardTap(key, ...modifiers),
      simulateMouseMove: (x: number, y: number) => window.intools?.input?.simulateMouseMove(x, y),
      simulateMouseClick: (x: number, y: number) => window.intools?.input?.simulateMouseClick(x, y),
      simulateMouseDoubleClick: (x: number, y: number) => window.intools?.input?.simulateMouseDoubleClick(x, y),
      simulateMouseRightClick: (x: number, y: number) => window.intools?.input?.simulateMouseRightClick(x, y),
    },

    // Storage API
    storage: {
      get: (key: string) => window.intools?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.intools?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.intools?.storage?.remove(key, pluginId),
    },

    // Notification API
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
        window.intools?.notification?.show(message, type),
    },

    // Window API
    window: {
      setSize: (width: number, height: number) => window.intools?.window?.setSize(width, height),
      setExpendHeight: (height: number) => window.intools?.window?.setExpendHeight?.(height),
      center: () => window.intools?.window?.center?.(),
      hide: (isRestorePreWindow?: boolean) => window.intools?.window?.hide?.(isRestorePreWindow),
      show: () => window.intools?.window?.show(),
      close: () => window.intools?.window?.close(),
      create: (url: string, options?: { width?: number; height?: number; title?: string }) =>
        window.intools?.window?.create(url, options),
      detach: () => window.intools?.window?.detach?.(),
      setAlwaysOnTop: (flag: boolean) => window.intools?.window?.setAlwaysOnTop?.(flag),
      getMode: () => window.intools?.window?.getMode?.(),
      getWindowType: () => window.intools?.window?.getWindowType?.(),
      minimize: () => window.intools?.window?.minimize?.(),
      maximize: () => window.intools?.window?.maximize?.(),
      getState: () => window.intools?.window?.getState?.(),
      reload: () => window.intools?.window?.reload?.(),
      sendToParent: (channel: string, ...args: unknown[]) =>
        window.intools?.window?.sendToParent?.(channel, ...args),
      onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) =>
        window.intools?.window?.onChildMessage?.(callback),
      findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
        window.intools?.window?.findInPage?.(text, options),
      stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
        window.intools?.window?.stopFindInPage?.(action),
      startDrag: (filePath: string | string[]) => window.intools?.window?.startDrag?.(filePath),
    },

    // SubInput API
    subInput: {
      set: (placeholder?: string, isFocus?: boolean) => window.intools?.subInput?.set?.(placeholder, isFocus),
      remove: () => window.intools?.subInput?.remove?.(),
      setValue: (text: string) => window.intools?.subInput?.setValue?.(text),
      focus: () => window.intools?.subInput?.focus?.(),
      blur: () => window.intools?.subInput?.blur?.(),
      select: () => window.intools?.subInput?.select?.(),
      onChange: (callback: (data: { text: string }) => void) => window.intools?.subInput?.onChange?.(callback),
    },

    // Plugin API
    plugin: {
      redirect: (label: string | [string, string], payload?: unknown) =>
        window.intools?.plugin?.redirect?.(label, payload),
      outPlugin: (isKill?: boolean) => window.intools?.plugin?.outPlugin?.(isKill),
    },

    // HTTP API
    http: {
      request: (options: {
        url: string
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
        headers?: Record<string, string>
        body?: unknown
        timeout?: number
      }) => window.intools?.http?.request(options),
      get: (url: string, headers?: Record<string, string>) => window.intools?.http?.get(url, headers),
      post: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.intools?.http?.post(url, body, headers),
      put: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.intools?.http?.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => window.intools?.http?.delete(url, headers),
    },

    // Filesystem API
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        window.intools?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.intools?.filesystem?.exists(path),
      readdir: (path: string) => window.intools?.filesystem?.readdir(path),
      mkdir: (path: string) => window.intools?.filesystem?.mkdir(path),
      stat: (path: string) => window.intools?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.intools?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.intools?.filesystem?.move(src, dest),
      unlink: (path: string) => window.intools?.filesystem?.unlink(path),
    },

    // Screen API
    screen: {
      getAllDisplays: () => window.intools?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.intools?.screen?.getPrimaryDisplay(),
      getCursorScreenPoint: () => window.intools?.screen?.getCursorScreenPoint(),
      getDisplayNearestPoint: (point: { x: number; y: number }) =>
        window.intools?.screen?.getDisplayNearestPoint?.(point),
      getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
        window.intools?.screen?.getDisplayMatching?.(rect),
      getSources: (options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }) =>
        window.intools?.screen?.getSources(options),
      capture: (options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }) =>
        window.intools?.screen?.capture(options),
      captureRegion: (region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }) =>
        window.intools?.screen?.captureRegion(region, options),
      screenCapture: () => window.intools?.screen?.screenCapture(),
      colorPick: () => window.intools?.screen?.colorPick?.(),
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

    // Dialog API
    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => window.intools?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }) => window.intools?.dialog?.showSaveDialog(options),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
      }) => window.intools?.dialog?.showMessageBox(options),
    },

    // System API
    system: {
      getSystemInfo: () => window.intools?.system?.getSystemInfo(),
      getAppInfo: () => window.intools?.system?.getAppInfo(),
      getPath: (name: string) => window.intools?.system?.getPath(name as any),
      getEnv: (name: string) => window.intools?.system?.getEnv(name),
      getIdleTime: () => window.intools?.system?.getIdleTime(),
      getFileIcon: (filePath: string) => window.intools?.system?.getFileIcon?.(filePath),
      getNativeId: () => window.intools?.system?.getNativeId?.(),
      isDev: () => window.intools?.system?.isDev?.(),
      isMacOS: () => window.intools?.system?.isMacOS?.(),
      isWindows: () => window.intools?.system?.isWindows?.(),
      isLinux: () => window.intools?.system?.isLinux?.(),
    },

    // Permission API
    permission: {
      getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.getStatus(type),
      request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.request(type),
      canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.canRequest(type),
      openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.openSystemSettings(type),
      isAccessibilityTrusted: () => window.intools?.permission?.isAccessibilityTrusted()
    },

    // Power API
    power: {
      getSystemIdleTime: () => window.intools?.power?.getSystemIdleTime(),
      getSystemIdleState: (threshold: number) => window.intools?.power?.getSystemIdleState(threshold),
      isOnBatteryPower: () => window.intools?.power?.isOnBatteryPower(),
      getCurrentThermalState: () => window.intools?.power?.getCurrentThermalState(),
    },

    // Network API
    network: {
      isOnline: () => window.intools?.network?.isOnline(),
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
      speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) =>
        window.intools?.tts?.speak(text, options),
      stop: () => window.intools?.tts?.stop(),
      pause: () => window.intools?.tts?.pause(),
      resume: () => window.intools?.tts?.resume(),
      getVoices: () => window.intools?.tts?.getVoices(),
      isSpeaking: () => window.intools?.tts?.isSpeaking(),
    },

    // Media API
    media: {
      getAccessStatus: (type: 'camera' | 'microphone') => window.intools?.media?.getAccessStatus(type),
      askForAccess: (type: 'camera' | 'microphone') => window.intools?.media?.askForAccess(type),
      hasCameraAccess: () => window.intools?.media?.hasCameraAccess(),
      hasMicrophoneAccess: () => window.intools?.media?.hasMicrophoneAccess(),
    },

    // Shortcut API
    shortcut: {
      register: (accelerator: string) => window.intools?.shortcut?.register(accelerator),
      unregister: (accelerator: string) => window.intools?.shortcut?.unregister(accelerator),
      unregisterAll: () => window.intools?.shortcut?.unregisterAll(),
      isRegistered: (accelerator: string) => window.intools?.shortcut?.isRegistered(accelerator),
    },

    // Security API
    security: {
      isEncryptionAvailable: () => window.intools?.security?.isEncryptionAvailable(),
      encryptString: (text: string) => window.intools?.security?.encryptString(text),
      decryptString: (data: ArrayBuffer) => window.intools?.security?.decryptString(data),
    },

    // Tray API
    tray: {
      create: (options: { icon: string; tooltip?: string; title?: string }) =>
        window.intools?.tray?.create(options),
      destroy: () => window.intools?.tray?.destroy(),
      setIcon: (icon: string) => window.intools?.tray?.setIcon(icon),
      setTooltip: (tooltip: string) => window.intools?.tray?.setTooltip(tooltip),
      setTitle: (title: string) => window.intools?.tray?.setTitle(title),
      exists: () => window.intools?.tray?.exists(),
    },

    // Menu API
    menu: {
      showContextMenu: (items: {
        label?: string
        type?: 'normal' | 'separator' | 'checkbox' | 'radio'
        checked?: boolean
        enabled?: boolean
        id?: string
        submenu?: unknown[]
      }[]) => window.intools?.menu?.showContextMenu(items as Parameters<typeof window.intools.menu.showContextMenu>[0]),
    },

    // Theme API
    theme: {
      get: () => window.intools?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.intools?.theme?.set(mode),
      getActual: () => window.intools?.theme?.getActual(),
    },

    // Host API
    host: {
      invoke: (pluginName: string, method: string, ...args: unknown[]) => window.intools?.host?.invoke(pluginName, method, ...args),
      status: (pluginName: string) => window.intools?.host?.status(pluginName),
      restart: (pluginName: string) => window.intools?.host?.restart(pluginName),
    },

    // InBrowser API
    inbrowser: window.intools?.inbrowser,

    // Sharp API
    sharp: window.intools?.sharp,
    getSharpVersion: () => window.intools?.getSharpVersion?.(),

    // FFmpeg API
    ffmpeg: window.intools?.ffmpeg,
  }), [pluginId])
}
`
}

export function buildGitignore() {
  return `node_modules
dist
/ui/
.DS_Store
*.log
`
}

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

### 安装依赖

\`\`\`bash
npm install
\`\`\`

### 开发模式

\`\`\`bash
npm run dev
\`\`\`

### 构建

\`\`\`bash
npm run build
\`\`\`

### 打包

\`\`\`bash
npm run pack
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
│   │   │   └── useIntools.ts  # InTools API Hook
│   │   └── types/
│   │       └── intools.d.ts   # 类型定义
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
└── icon.png                   # 插件图标
\`\`\`

## 许可证

MIT License
`
}

export function buildIntoolsTypes() {
  return `// InTools API 类型定义

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
  writeImage(image: string | ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  writeFiles(files: string | string[]): Promise<boolean>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface IntoolsInput {
  hideMainWindowPasteText(text: string): Promise<boolean>
  hideMainWindowPasteImage(image: string | ArrayBuffer): Promise<boolean>
  hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean>
  hideMainWindowTypeString(text: string): Promise<boolean>
  simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean>
  simulateMouseMove(x: number, y: number): Promise<boolean>
  simulateMouseClick(x: number, y: number): Promise<boolean>
  simulateMouseDoubleClick(x: number, y: number): Promise<boolean>
  simulateMouseRightClick(x: number, y: number): Promise<boolean>
}

interface IntoolsNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface BrowserWindowProxy {
  id: number
  show(): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  focus(): Promise<void>
  setTitle(title: string): Promise<void>
  setSize(width: number, height: number): Promise<void>
  setPosition(x: number, y: number): Promise<void>
  postMessage(channel: string, ...args: unknown[]): Promise<void>
}

interface IntoolsWindow {
  hide(isRestorePreWindow?: boolean): void
  show(): void
  setSize(width: number, height: number): void
  setExpendHeight(height: number): void
  center(): void
  create(url: string, options?: { width?: number; height?: number; title?: string }): Promise<BrowserWindowProxy | null>
  close(): void
  detach(): void
  setAlwaysOnTop(flag: boolean): void
  getMode(): Promise<'attached' | 'detached'>
  getWindowType(): Promise<'main' | 'detach'>
  minimize(): void
  maximize(): void
  getState(): Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean }>
  reload(): void
  sendToParent(channel: string, ...args: unknown[]): void
  onChildMessage(callback: (channel: string, ...args: unknown[]) => void): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<number>
  stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  startDrag(filePath: string | string[]): void
}

interface IntoolsSubInput {
  set(placeholder?: string, isFocus?: boolean): Promise<boolean>
  remove(): Promise<boolean>
  setValue(text: string): void
  focus(): void
  blur(): void
  select(): void
  onChange(callback: (data: { text: string }) => void): void
}

interface IntoolsTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  set(mode: 'light' | 'dark' | 'system'): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
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
  redirect(label: string | [string, string], payload?: unknown): Promise<boolean | { candidates: { name: string; displayName: string }[] }>
  outPlugin(isKill?: boolean): Promise<boolean>
}

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

interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface IntoolsScreen {
  getAllDisplays(): Promise<DisplayInfo[]>
  getPrimaryDisplay(): Promise<DisplayInfo>
  getDisplayNearestPoint(point: { x: number; y: number }): Promise<DisplayInfo>
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Promise<DisplayInfo>
  getCursorScreenPoint(): Promise<{ x: number; y: number }>
  getSources(options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }): Promise<CaptureSource[]>
  capture(options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  captureRegion(region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  getMediaStreamConstraints(options: { sourceId: string; audio?: boolean; frameRate?: number }): Promise<object>
  screenCapture(): Promise<string | null>
  colorPick(): Promise<ColorPickResult | null>
}

interface IntoolsShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
}

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
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
  getFileIcon(filePath: string): Promise<string>
  getNativeId(): Promise<string>
  isDev(): Promise<boolean>
  isMacOS(): Promise<boolean>
  isWindows(): Promise<boolean>
  isLinux(): Promise<boolean>
}

interface IntoolsPermission {
  getStatus(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  request(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  canRequest(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  openSystemSettings(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  isAccessibilityTrusted(): Promise<boolean>
}

interface IntoolsShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): void
}

interface IntoolsSecurity {
  isEncryptionAvailable(): Promise<boolean>
  encryptString(plainText: string): Promise<ArrayBuffer>
  decryptString(encrypted: ArrayBuffer): Promise<string>
}

interface IntoolsMedia {
  getAccessStatus(mediaType: 'microphone' | 'camera'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
  hasCameraAccess(): Promise<boolean>
  hasMicrophoneAccess(): Promise<boolean>
}

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

interface IntoolsTray {
  create(options: { icon: string; tooltip?: string; title?: string }): Promise<boolean>
  destroy(): Promise<void>
  setIcon(icon: string): Promise<void>
  setTooltip(tooltip: string): Promise<void>
  setTitle(title: string): Promise<void>
  exists(): Promise<boolean>
}

interface IntoolsNetwork {
  isOnline(): Promise<boolean>
}

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

interface IntoolsGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  requestAccess(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  canGetPosition(): Promise<boolean>
  openSettings(): Promise<void>
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

interface IntoolsTTS {
  speak(text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  getVoices(): { name: string; lang: string; default: boolean; localService: boolean }[]
  isSpeaking(): boolean
}

interface IntoolsStorage {
  get(key: string, namespace?: string): Promise<unknown>
  set(key: string, value: unknown, namespace?: string): Promise<void>
  remove(key: string, namespace?: string): Promise<void>
}

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
}

interface IntoolsHost {
  invoke(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
  status(pluginName: string): Promise<{ ready: boolean; active: boolean }>
  restart(pluginName: string): Promise<boolean>
}

interface FFmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

interface FFmpegDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent: number
  downloaded?: number
  total?: number
}

interface FFmpegTask {
  promise: Promise<void>
  kill(): void
  quit(): void
}

interface IntoolsFFmpeg {
  isAvailable(): Promise<boolean>
  getVersion(): Promise<string | null>
  getPath(): Promise<string | null>
  download(onProgress?: (progress: FFmpegDownloadProgress) => void): Promise<{ success: boolean; error?: string }>
  run(args: string[], onProgress?: (progress: FFmpegRunProgress) => void): FFmpegTask
}

interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  feature?: string
  input: string
  mode?: string
  route?: string
  attachments?: Attachment[]
}

interface IntoolsAPI {
  clipboard: IntoolsClipboard
  input: IntoolsInput
  notification: IntoolsNotification
  window: IntoolsWindow
  subInput: IntoolsSubInput
  plugin: IntoolsPlugin
  theme?: IntoolsTheme
  screen: IntoolsScreen
  shell: IntoolsShell
  dialog: IntoolsDialog
  system: IntoolsSystem
  permission: IntoolsPermission
  shortcut: IntoolsShortcut
  security: IntoolsSecurity
  media: IntoolsMedia
  power: IntoolsPower
  tray: IntoolsTray
  network: IntoolsNetwork
  menu: IntoolsMenu
  geolocation: IntoolsGeolocation
  tts: IntoolsTTS
  storage: IntoolsStorage
  http: IntoolsHttp
  filesystem: IntoolsFilesystem
  host?: IntoolsHost
  onPluginInit(callback: (data: PluginInitData) => void): void
  onPluginAttach?(callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void): void
  onPluginDetached?(callback: () => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
  onWindowStateChange?(callback: (state: { isMaximized: boolean }) => void): void
  inbrowser: {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => any
    useragent: (ua: string) => any
    device: (name: string) => any
    viewport: (width: number, height: number) => any
    show: () => any
    hide: () => any
    evaluate: (func: string | Function, ...params: any[]) => any
    wait: (msOrSelector: number | string) => any
    click: (selector: string) => any
    mousedown: (selector: string) => any
    mouseup: (selector: string) => any
    scroll: (selector: string | number, y?: number) => any
    devTools: (mode?: 'right' | 'bottom' | 'undocked' | 'detach') => any
    paste: (text: string) => any
    file: (selector: string, payload: string | string[]) => any
    end: () => any
    type: (selector: string, text: string) => any
    press: (key: string, modifiers?: string[]) => any
    check: (selector: string, checked: boolean) => any
    value: (selector: string, val: string) => any
    focus: (selector: string) => any
    when: (selector: string | Function, ...params: any[]) => any
    css: (css: string) => any
    pdf: (options?: any, savePath?: string) => any
    cookies: (nameOrFilter?: string | any) => any
    clearCookies: (url?: string) => any
    input: (selectorOrText: string, text?: string) => any
    dblclick: (selector: string) => any
    hover: (selector: string) => any
    screenshot: (target?: any, savePath?: string) => any
    drop: (selector: string, payload: any) => any
    download: (urlOrFunc: string | Function, savePath?: string, ...params: any[]) => any
    removeCookies: (name: string) => any
    setCookies: (nameOrCookies: any, value?: string) => any
    markdown: (selector?: string) => any
    getIdleInBrowsers: () => Promise<any[]>
    setInBrowserProxy: (config: any) => Promise<boolean>
    clearInBrowserCache: () => Promise<boolean>
    run: (idOrOptions?: number | any, options?: any) => Promise<any[]>
  }
  sharp: IntoolsSharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  ffmpeg: IntoolsFFmpeg
}

interface IntoolsSharpProxy {
  resize(width?: number, height?: number, options?: object): IntoolsSharpProxy
  extend(options: object): IntoolsSharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): IntoolsSharpProxy
  trim(options?: object): IntoolsSharpProxy
  rotate(angle?: number, options?: object): IntoolsSharpProxy
  flip(): IntoolsSharpProxy
  flop(): IntoolsSharpProxy
  blur(sigma?: number): IntoolsSharpProxy
  sharpen(options?: object): IntoolsSharpProxy
  flatten(options?: object): IntoolsSharpProxy
  gamma(gamma?: number): IntoolsSharpProxy
  negate(options?: object): IntoolsSharpProxy
  normalize(options?: object): IntoolsSharpProxy
  threshold(threshold?: number, options?: object): IntoolsSharpProxy
  modulate(options?: object): IntoolsSharpProxy
  tint(color: string | object): IntoolsSharpProxy
  greyscale(greyscale?: boolean): IntoolsSharpProxy
  grayscale(grayscale?: boolean): IntoolsSharpProxy
  composite(images: object[]): IntoolsSharpProxy
  png(options?: object): IntoolsSharpProxy
  jpeg(options?: object): IntoolsSharpProxy
  webp(options?: object): IntoolsSharpProxy
  gif(options?: object): IntoolsSharpProxy
  tiff(options?: object): IntoolsSharpProxy
  avif(options?: object): IntoolsSharpProxy
  withMetadata(options?: object): IntoolsSharpProxy
  clone(): IntoolsSharpProxy
  toBuffer(options?: object): Promise<ArrayBuffer>
  toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }>
  metadata(): Promise<{ format?: string; width?: number; height?: number; channels?: number; space?: string; depth?: string; density?: number; hasAlpha?: boolean; orientation?: number }>
  stats(): Promise<object>
}

type IntoolsSharpFunction = (
  input?: string | ArrayBuffer | Uint8Array | object | any[],
  options?: object
) => IntoolsSharpProxy

declare global {
  interface Window {
    intools: IntoolsAPI
  }
}

export {}
`
}
