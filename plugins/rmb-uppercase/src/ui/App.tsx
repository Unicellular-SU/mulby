import { useEffect, useState } from 'react'
import { useIntools } from './hooks/useIntools'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const { clipboard, notification } = useIntools('rmb-uppercase')

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
      <div className="titlebar">rmb-uppercase</div>
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
