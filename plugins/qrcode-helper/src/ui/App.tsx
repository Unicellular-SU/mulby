import { useEffect, useState } from 'react'
import { QRCodeGenerator } from './components/QRCodeGenerator'
import { QRCodeScanner } from './components/QRCodeScanner'
import { useIntools } from './hooks/useIntools'
import './styles.css'

interface PluginInitData {
  input: string
  // other fields...
}

type Tab = 'generate' | 'scan'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate')
  const [initialInput, setInitialInput] = useState('')
  const { window: windowApi } = useIntools()

  useEffect(() => {
    // 确保窗口显示
    windowApi.show()

    const handleInit = (data: PluginInitData) => {
      // 如果有输入文本，自动切换到生成模式并填入
      if (data && data.input) {
        setInitialInput(data.input)
        setActiveTab('generate')
      }
    }

    // 监听插件初始化
    if (window.intools && window.intools.onPluginInit) {
      window.intools.onPluginInit(handleInit)
    }
  }, [windowApi])

  return (
    <div className="app">
      <div className="tabs">
        <div
          className={`tab ${activeTab === 'generate' ? 'active' : ''}`}
          onClick={() => setActiveTab('generate')}
        >
          生成二维码
        </div>
        <div
          className={`tab ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          识别二维码
        </div>
      </div>

      <div className="content-area">
        {activeTab === 'generate' ? (
          <QRCodeGenerator initialValue={initialInput} />
        ) : (
          <QRCodeScanner />
        )}
      </div>
    </div>
  )
}
