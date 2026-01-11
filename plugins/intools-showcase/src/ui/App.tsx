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

console.log('[App] Module imports loaded')

type ModuleId = 'sysinfo' | 'clipboard' | 'filemanager' | 'network' | 'screen' | 'media' | 'settings' | 'security'

// 模块映射
const moduleComponents: Record<ModuleId, React.FC> = {
  sysinfo: SystemInfoModule,
  clipboard: ClipboardModule,
  filemanager: FileManagerModule,
  network: NetworkModule,
  screen: ScreenModule,
  media: MediaModule,
  settings: SettingsModule,
  security: SecurityModule,
}

// 从 URL 参数或插件初始化数据获取默认模块
function getInitialModule(): ModuleId {
  console.log('[App] getInitialModule called', window.location.search)
  // 强制只返回 sysinfo
  return 'sysinfo'
}

export default function App() {
  console.log('[App] Rendering...')
  const [activeModule, setActiveModule] = useState<ModuleId>(getInitialModule)

  // 初始化主题
  useTheme()

  // 监听插件初始化
  useEffect(() => {
    console.log('[App] Mount effect')
    window.intools?.onPluginInit?.((data) => {
      console.log('[App] onPluginInit received data:', data)
      // 这里的逻辑暂时简化，因为我们只有 sysinfo
      // 如果将来需要恢复，可以看 git 历史
    })
  }, [])

  const ActiveModuleComponent = moduleComponents[activeModule]

  const handleModuleChange = (id: string) => {
    console.log('[App] handleModuleChange:', id)
    if (id in moduleComponents) {
      setActiveModule(id as ModuleId)
    }
  }

  return (
    <div className="app">
      <Sidebar
        activeModule={activeModule}
        onModuleChange={handleModuleChange}
      />
      {ActiveModuleComponent ? (
        <ActiveModuleComponent />
      ) : (
        <div>Module not found</div>
      )}
    </div>
  )
}
