export function buildBasicManifest(name: string) {
  return {
    id: name,
    name,
    version: '1.0.0',
    displayName: name,
    author: 'intools',
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
}

export function buildBasicPackageJson(name: string) {
  return {
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
}

export function buildBasicMain(name: string) {
  return `interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => Uint8Array | null
      writeImage: (buffer: Uint8Array) => void
      readFiles: () => Array<{ path: string; name: string; size: number; isDirectory: boolean }>
      getFormat: () => 'text' | 'image' | 'files' | 'empty'
    }
    clipboardHistory: {
      query: (options?: {
        type?: 'text' | 'image' | 'files'
        search?: string
        favorite?: boolean
        limit?: number
        offset?: number
      }) => Promise<any[]>
      get: (id: string) => Promise<any>
      copy: (id: string) => Promise<{ success: boolean; error?: string }>
      toggleFavorite: (id: string) => Promise<{ success: boolean }>
      delete: (id: string) => Promise<{ success: boolean }>
      clear: () => Promise<{ success: boolean }>
      stats: () => Promise<{ total: number; text: number; image: number; files: number; favorite: number }>
    }
    notification: {
      show: (message: string, type?: string) => void
    }
    storage: {
      get: (key: string) => unknown
      set: (key: string, value: unknown) => unknown
      remove: (key: string) => unknown
      clear: () => unknown
      keys: () => string[]
    }
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string | Uint8Array>
      writeFile: (path: string, data: string | Uint8Array, encoding?: 'utf-8' | 'base64') => Promise<void>
      exists: (path: string) => Promise<boolean>
      unlink: (path: string) => Promise<void>
      readdir: (path: string) => Promise<string[]>
      mkdir: (path: string) => Promise<void>
      stat: (path: string) => Promise<any>
      copy: (src: string, dest: string) => Promise<void>
      move: (src: string, dest: string) => Promise<void>
      extname: (path: string) => string
      join: (...paths: string[]) => string
      dirname: (path: string) => string
      basename: (path: string, ext?: string) => string
    }
    http: {
      request: (options: { url: string; method?: string; headers?: Record<string, string>; body?: string | object; timeout?: number }) => Promise<any>
      get: (url: string, headers?: Record<string, string>) => Promise<any>
      post: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<any>
      put: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<any>
      delete: (url: string, headers?: Record<string, string>) => Promise<any>
    }
    screen: {
      getAllDisplays: () => Promise<any[]>
      getPrimaryDisplay: () => Promise<any>
      getDisplayNearestPoint: (point: { x: number; y: number }) => Promise<any>
      getCursorScreenPoint: () => Promise<{ x: number; y: number }>
      getSources: (options?: any) => Promise<any[]>
      capture: (options?: any) => Promise<Uint8Array>
      captureRegion: (region: { x: number; y: number; width: number; height: number }, options?: any) => Promise<Uint8Array>
      getMediaStreamConstraints: (options: any) => Promise<any>
    }
    shell: {
      openPath: (path: string) => Promise<string>
      openExternal: (url: string) => Promise<void>
      showItemInFolder: (path: string) => void
      openFolder: (path: string) => Promise<string>
      trashItem: (path: string) => Promise<void>
      beep: () => void
      runCommand: (input: {
        command: string
        args?: string[]
        cwd?: string
        env?: Record<string, string>
        timeoutMs?: number
        shell?: boolean
      }) => Promise<any>
      getRunCommandPolicy: () => Promise<{
        enabled: boolean
        requireConsent: boolean
        allowShell: boolean
        allowList?: string[]
        denyList?: string[]
      }>
      listRunCommandAudit: (limit?: number) => Promise<any[]>
    }
    dialog: {
      showOpenDialog: (options?: any) => Promise<string[]>
      showSaveDialog: (options?: any) => Promise<string | null>
      showMessageBox: (options: any) => Promise<{ response: number }>
      showErrorBox: (title: string, content: string) => void
    }
    system: {
      getSystemInfo: () => Promise<any>
      getAppInfo: () => Promise<any>
      getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => Promise<string>
      getEnv: (name: string) => Promise<string>
      getIdleTime: () => Promise<number>
    }
    shortcut: Record<string, (...args: any[]) => any>
    security: Record<string, (...args: any[]) => any>
    media: {
      getAccessStatus: (mediaType: 'microphone' | 'camera') => 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
      askForAccess: (mediaType: 'microphone' | 'camera') => Promise<boolean>
      hasCameraAccess: () => Promise<boolean>
      hasMicrophoneAccess: () => Promise<boolean>
    }
    power: {
      getSystemIdleTime: () => number
      getSystemIdleState: (idleThreshold: number) => 'active' | 'idle' | 'locked' | 'unknown'
      isOnBatteryPower: () => boolean
      getCurrentThermalState: () => 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'
    }
    tray: Record<string, (...args: any[]) => any>
    network: {
      isOnline: () => boolean
    }
    input: Record<string, (...args: any[]) => any>
    permission: {
      getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => any
      request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<any>
      canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => any
      openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<any>
      isAccessibilityTrusted: () => boolean
    }
    features: {
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
    messaging: {
      send: (targetPluginId: string, type: string, payload: unknown) => Promise<void>
      broadcast: (type: string, payload: unknown) => Promise<void>
      on: (handler: (message: { id: string; from: string; to?: string; type: string; payload: unknown; timestamp: number }) => void | Promise<void>) => void
      off: (handler?: (message: any) => void) => void
    }
    scheduler: {
      schedule: (task: {
        name: string
        type: 'once' | 'repeat' | 'delay'
        callback: string
        time?: number
        cron?: string
        delay?: number
        payload?: any
        maxRetries?: number
        retryDelay?: number
        timeout?: number
      }) => Promise<any>
      cancel: (taskId: string) => Promise<void>
      pause: (taskId: string) => Promise<void>
      resume: (taskId: string) => Promise<void>
      get: (taskId: string) => Promise<any>
      list: (filter?: { status?: string; type?: string; limit?: number }) => Promise<any[]>
      getExecutions: (taskId: string, limit?: number) => Promise<any[]>
      validateCron: (expression: string) => boolean
      getNextCronTime: (expression: string, after?: Date) => Date
      describeCron: (expression: string) => string
    }
    ai: {
      call: (option: {
        model?: string
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content?: string | Array<any> }>
        tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: object } }>
        capabilities?: string[]
        internalTools?: string[]
        toolingPolicy?: {
          enableInternalTools?: boolean
          capabilityAllowList?: string[]
          capabilityDenyList?: string[]
        }
        mcp?: { mode?: 'off' | 'manual' | 'auto'; serverIds?: string[]; allowedToolIds?: string[] }
        skills?: { mode?: 'off' | 'manual' | 'auto'; skillIds?: string[]; variables?: Record<string, string> }
        params?: any
        toolContext?: {
          pluginName?: string
          internalTag?: string
          mcpScope?: { allowedServerIds?: string[]; allowedToolIds?: string[] }
        }
        maxToolSteps?: number
      }, onChunk?: (chunk: any) => void) => Promise<{ role: 'assistant'; content?: string }>
      allModels: () => Promise<any[]>
      abort: (requestId: string) => void
      skills: {
        listEnabled: () => Promise<any[]>
        previewForCall: (input: { option?: Record<string, any>; skillIds?: string[]; prompt?: string }) => Promise<any>
      }
      tokens: {
        estimate: (input: { model?: string; messages: Array<any>; outputText?: string }) => Promise<{ inputTokens: number; outputTokens: number }>
      }
      attachments: {
        upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<any>
        get: (attachmentId: string) => Promise<any>
        delete: (attachmentId: string) => Promise<void>
        uploadToProvider: (input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }) => Promise<{
          providerId: string
          fileId: string
          uri?: string
        }>
      }
      images: {
        generate: (input: { model: string; prompt: string; size?: string; count?: number }) => Promise<{
          images: string[]
          tokens: { inputTokens: number; outputTokens: number }
        }>
        generateStream: (
          input: { model: string; prompt: string; size?: string; count?: number },
          onChunk: (chunk: any) => void
        ) => Promise<{ images: string[]; tokens: { inputTokens: number; outputTokens: number } }>
        edit: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{
          images: string[]
          tokens: { inputTokens: number; outputTokens: number }
        }>
      }
    }
  }
  input?: string
  featureCode?: string
  attachments?: Array<any>
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
  const { clipboard, notification } = context.api
  const text = context.input || clipboard.readText()

  // 在这里实现你的逻辑
  const result = text.toUpperCase()

  await clipboard.writeText(result)
  notification.show('处理完成')
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
│   └── main.ts                # 后端入口
├── dist/                      # 构建输出
└── icon.png                   # 插件图标
\`\`\`

## 许可证

MIT License
`
}
