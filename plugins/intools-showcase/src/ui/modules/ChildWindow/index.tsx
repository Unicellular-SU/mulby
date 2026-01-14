import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useIntools } from '../../hooks'

export function ChildWindowModule() {
    const { window: win } = useIntools()
    const [messages, setMessages] = useState<string[]>([])
    const [receivedMsg, setReceivedMsg] = useState('')

    useEffect(() => {
        // Listen for messages from parent
        win.onChildMessage((channel, ...args) => {
            console.log('[ChildWindow] Received message:', channel, args)
            const msg = `[${channel}] ${args.join(', ')}`
            setReceivedMsg(msg)
            setMessages(prev => [...prev, msg])
        })
    }, [win])

    const handleSendToParent = () => {
        win.sendToParent('child-event', 'Hello from child window!', new Date().toISOString())
    }

    const handleClose = () => {
        window.close()
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="👶"
                title="子窗口 (Child Window)"
                description="这是一个由 createBrowserWindow 创建的独立子窗口"
            />
            <div className="page-content">
                <div className="grid grid-2">
                    <Card title="通信测试" icon="💬">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: 'var(--spacing-xs)' }}>
                                    收到的消息:
                                </div>
                                <div style={{
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: 'var(--radius-sm)',
                                    minHeight: '60px',
                                    maxHeight: '120px',
                                    overflowY: 'auto',
                                    fontFamily: 'monospace',
                                    fontSize: '12px'
                                }}>
                                    {messages.length > 0 ? (
                                        messages.map((m, i) => <div key={i}>{m}</div>)
                                    ) : (
                                        <span style={{ color: 'var(--text-tertiary)' }}>暂无消息...</span>
                                    )}
                                </div>
                            </div>

                            <Button onClick={handleSendToParent}>发送消息给父窗口</Button>
                        </div>
                    </Card>

                    <Card title="窗口控制" icon="🎛️">
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            <Button variant="secondary" onClick={() => win.maximize()}>最大化/还原</Button>
                            <Button variant="secondary" onClick={handleClose}>关闭窗口</Button>
                        </div>
                    </Card>
                </div>

                <Card title="代码示例" icon="💻">
                    <CodeBlock>
                        {`// Receive message from parent
window.intools.window.onChildMessage((channel, ...args) => {
  console.log(channel, args)
})

// Send message to parent
window.intools.window.sendToParent('event', 'data')`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
