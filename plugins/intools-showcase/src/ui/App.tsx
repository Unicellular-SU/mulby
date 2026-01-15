import { useEffect, useState } from 'react'
import { Sidebar } from './components'
import { useTheme } from './hooks'
import {
  SystemInfoModule,
  ClipboardModule,
  InputModule,
  FileManagerModule,
  NetworkModule,
  ScreenModule,
  MediaModule,
  SettingsModule,
  SecurityModule,
  ImageEditor,
  WindowAPIModule,
  ChildWindowModule,
} from './modules'

console.log('[App] Module imports loaded')

type ModuleId = 'sysinfo' | 'clipboard' | 'input' | 'filemanager' | 'network' | 'screen' | 'media' | 'settings' | 'security' | 'image-editor' | 'window-api' | 'child-window'

// 模块映射
const moduleComponents: Record<ModuleId, React.FC> = {
  sysinfo: SystemInfoModule,
  clipboard: ClipboardModule,
  input: InputModule,
  filemanager: FileManagerModule,
  network: NetworkModule,
  screen: ScreenModule,
  media: MediaModule,
  settings: SettingsModule,
  security: SecurityModule,
  'image-editor': ImageEditor,
  'window-api': WindowAPIModule,
  'child-window': ChildWindowModule,
}

// 从 URL 参数或插件初始化数据获取默认模块
function getInitialModule(): ModuleId {
  console.log('[App] getInitialModule called', window.location.search, window.location.hash)
  const hash = window.location.hash
  if (hash.includes('image-editor')) {
    return 'image-editor'
  }
  if (hash.includes('child-window')) {
    return 'child-window'
  }
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
      if (data.route && data.route.includes('image-editor')) {
        setActiveModule('image-editor')
      } else if (data.route && data.route.includes('child-window')) {
        setActiveModule('child-window')
      } else if (data.featureCode === 'input') {
        setActiveModule('input')
      }
    })
  }, [])

  const ActiveModuleComponent = moduleComponents[activeModule]

  const handleModuleChange = (id: string) => {
    console.log('[App] handleModuleChange:', id)
    if (id in moduleComponents) {
      setActiveModule(id as ModuleId)
    }
  }

  // 如果是图片编辑器，不显示侧边栏
  if (activeModule === 'image-editor') {
    return (
      <div className="app" style={{ display: 'block' }}>
        {ActiveModuleComponent ? <ActiveModuleComponent /> : <div>Module not found</div>}
      </div>
    )
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
