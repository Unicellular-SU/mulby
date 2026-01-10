import { useEffect, useState } from 'react'
import { Sidebar } from './components'
import { useTheme } from './hooks'
import {
  SystemInfoModule,
  ClipboardModule,
  FileManagerModule,
  NetworkModule,
  ScreenModule,
  MediaModule,
  SettingsModule,
  SecurityModule,
} from './modules'

type ModuleId = 'sysinfo' | 'clipboard' | 'files' | 'network' | 'screen' | 'media' | 'settings' | 'security'

// 模块映射
const moduleComponents: Record<ModuleId, React.FC> = {
  sysinfo: SystemInfoModule,
  clipboard: ClipboardModule,
  files: FileManagerModule,
  network: NetworkModule,
  screen: ScreenModule,
  media: MediaModule,
  settings: SettingsModule,
  security: SecurityModule,
}

// 从 URL 参数或插件初始化数据获取默认模块
function getInitialModule(): ModuleId {
  const params = new URLSearchParams(window.location.search)
  const feature = params.get('feature')

  // 根据 feature code 映射到模块
  const featureMap: Record<string, ModuleId> = {
    main: 'sysinfo',
    sysinfo: 'sysinfo',
    clipboard: 'clipboard',
    files: 'files',
    network: 'network',
    screen: 'screen',
    media: 'media',
    settings: 'settings',
    security: 'security',
  }

  return (feature && featureMap[feature]) || 'sysinfo'
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>(getInitialModule)

  // 初始化主题
  useTheme()

  // 监听插件初始化
  useEffect(() => {
    window.intools?.onPluginInit?.((data) => {
      // 根据 featureCode 切换模块
      if (data.feature) {
        const featureMap: Record<string, ModuleId> = {
          main: 'sysinfo',
          sysinfo: 'sysinfo',
          clipboard: 'clipboard',
          files: 'files',
          network: 'network',
          screen: 'screen',
          screenshot: 'screen',
          media: 'media',
          settings: 'settings',
          security: 'security',
        }
        const moduleId = featureMap[data.feature]
        if (moduleId) {
          setActiveModule(moduleId)
        }
      }
    })
  }, [])

  const ActiveModuleComponent = moduleComponents[activeModule]

  return (
    <div className="app">
      <Sidebar
        activeModule={activeModule}
        onModuleChange={(id) => setActiveModule(id as ModuleId)}
      />
      <ActiveModuleComponent />
    </div>
  )
}
