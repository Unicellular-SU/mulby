export function buildBasicManifest(name: string) {
  return {
    id: name,
    name,
    version: '1.0.0',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
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
