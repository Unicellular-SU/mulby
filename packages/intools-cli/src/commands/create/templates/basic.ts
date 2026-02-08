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
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    notification: {
      show: (message: string, type?: string) => void
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
      cancelTask: (taskId: string) => Promise<void>
      pauseTask: (taskId: string) => Promise<void>
      resumeTask: (taskId: string) => Promise<void>
      listTasks: (filter?: { status?: string; type?: string; limit?: number; offset?: number }) => Promise<any[]>
      getTaskCount: (filter?: { status?: string; type?: string }) => Promise<number>
      getTask: (taskId: string) => Promise<any>
      deleteTasks: (taskIds: string[]) => Promise<{ success: boolean; deletedCount: number }>
      cleanupTasks: (olderThan?: number) => Promise<{ success: boolean; deletedCount: number }>
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
        mcp?: { mode?: 'off' | 'manual' | 'auto'; serverIds?: string[]; allowedToolIds?: string[] }
        params?: any
        toolContext?: { pluginName?: string; mcpScope?: { allowedServerIds?: string[]; allowedToolIds?: string[] } }
      }, onChunk?: (chunk: any) => void) => Promise<{ role: 'assistant'; content?: string }>
      allModels: () => Promise<any[]>
      tokens: {
        estimate: (input: { model?: string; messages: Array<any> }) => Promise<{ inputTokens: number; outputTokens: number }>
      }
      attachments: {
        upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<any>
        get: (attachmentId: string) => Promise<any>
        delete: (attachmentId: string) => Promise<void>
      }
      images: {
        generate: (input: { model: string; prompt: string; size?: string; count?: number }) => Promise<{ images: string[] }>
        edit: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{ images: string[] }>
      }
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
