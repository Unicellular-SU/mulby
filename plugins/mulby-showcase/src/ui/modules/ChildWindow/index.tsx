import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

export function ChildWindowModule() {
    const { window: win } = useMulby()
    const notify = useNotification()
    const [messages, setMessages] = useState<string[]>([])
    const [childWin, setChildWin] = useState<any | null>(null)
    const [windowId, setWindowId] = useState<string>('--')

    useEffect(() => {
        // 获取当前窗口信息
        win.getWindowType().then((type: string) => {
            setWindowId(`${type}-${Date.now() % 10000}`)
        })

        // 监听来自父窗口的消息
        win.onChildMessage((channel: string, ...args: unknown[]) => {
            console.log('[ChildWindow] Received message:', channel, args)
            const msg = `[${new Date().toLocaleTimeString()}] ${channel}: ${args.join(', ')}`
            setMessages(prev => [...prev.slice(-9), msg]) // 保留最近10条

            // 如果收到需要转发的消息，转发给自己的子窗口
            if (channel === 'broadcast' && childWin) {
                childWin.postMessage('broadcast', ...args)
            }
        })
    }, [win, childWin])

    const handleSendToParent = () => {
        win.sendToParent('child-event', `来自 ${windowId} 的消息`, new Date().toISOString())
        notify.success('已发送消息给父窗口')
    }

    const handleRequestRelay = () => {
        // 请求父窗口转发消息给兄弟窗口
        win.sendToParent('relay-request', {
            from: windowId,
            message: `请转发此消息给其他子窗口`,
            timestamp: new Date().toISOString()
        })
        notify.info('已请求父窗口转发消息')
    }

    const handleCreateGrandchild = async () => {
        if (childWin) {
            notify.warning('已存在子窗口')
            return
        }
        try {
            const proxy = await win.create('/child-window', {
                width: 500,
                height: 350,
                title: `孙窗口 (由 ${windowId} 创建)`
            })
            if (proxy) {
                setChildWin(proxy)
                notify.success('子窗口创建成功')
            }
        } catch (error) {
            notify.error('创建子窗口失败')
        }
    }

    const handleSendToChild = () => {
        if (!childWin) return
        childWin.postMessage('parent-msg', `来自 ${windowId}`, Date.now())
        notify.success('已发送消息给子窗口')
    }

    const handleCloseChild = async () => {
        if (!childWin) return
        await childWin.close()
        setChildWin(null)
    }

    const handleClose = () => {
        window.close()
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="👶"
                title={`子窗口 (${windowId})`}
                description="演示精准的父子窗口通信（消息不会发给兄弟窗口）"
            />
            <div className="page-content">
                <div className="grid grid-2">
                    {/* 接收消息 */}
                    <Card title="接收到的消息" icon="📨">
                        <div style={{
                            padding: 'var(--spacing-sm)',
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            minHeight: '100px',
                            maxHeight: '150px',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '11px'
                        }}>
                            {messages.length > 0 ? (
                                messages.map((m, i) => <div key={i}>{m}</div>)
                            ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>等待消息...</span>
                            )}
                        </div>
                    </Card>

                    {/* 发送消息 */}
                    <Card title="发送消息" icon="📤">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            <Button onClick={handleSendToParent}>发送给父窗口</Button>
                            <Button variant="secondary" onClick={handleRequestRelay}>
                                请求转发给兄弟
                            </Button>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                消息只会发给直接父窗口，不会发给兄弟窗口
                            </div>
                        </div>
                    </Card>
                </div>

                {/* 创建自己的子窗口 */}
                <Card title="创建下一级子窗口" icon="👪">
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button onClick={handleCreateGrandchild} disabled={!!childWin}>
                            创建子窗口
                        </Button>
                        <Button variant="secondary" onClick={handleSendToChild} disabled={!childWin}>
                            发送消息
                        </Button>
                        <Button variant="secondary" onClick={handleCloseChild} disabled={!childWin}>
                            关闭子窗口
                        </Button>
                        {childWin && (
                            <span style={{ fontSize: '12px', color: 'var(--success-color)' }}>
                                ✓ 子窗口已创建
                            </span>
                        )}
                    </div>
                    <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        可以创建多级嵌套的子窗口，每一级只能与直接父/子通信
                    </div>
                </Card>

                {/* 窗口控制 */}
                <Card title="窗口控制" icon="🎛️">
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                        <Button variant="secondary" onClick={() => win.maximize()}>最大化/还原</Button>
                        <Button variant="secondary" onClick={handleClose}>关闭窗口</Button>
                    </div>
                </Card>

                {/* 代码示例 */}
                <Card title="消息路由说明" icon="📖">
                    <CodeBlock>
                        {`// 子窗口间通信需要通过父窗口中转:
// 1. 子窗口A 发送给父窗口
window.mulby.window.sendToParent('relay-request', data)

// 2. 父窗口收到后，转发给子窗口B
win.onChildMessage((channel, data) => {
  if (channel === 'relay-request') {
    childWindowB.postMessage('relayed', data)
  }
})

// 消息隔离保证:
// ✅ 不同插件之间完全隔离
// ✅ 兄弟窗口之间不会直接收到消息
// ✅ 只有直接父子才能通信`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
