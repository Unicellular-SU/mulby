import { useState, useEffect, useCallback } from 'react'
import type { DragEvent } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

export function WindowAPIModule() {
    const { window: win, subInput, plugin, filesystem, system, dialog } = useMulby()
    const notify = useNotification()

    // 窗口状态
    const [windowType, setWindowType] = useState<string>('-')
    const [windowMode, setWindowMode] = useState<string>('-')
    const [windowState, setWindowState] = useState<{ isMaximized: boolean; isAlwaysOnTop: boolean } | null>(null)

    // SubInput 状态
    const [subInputEnabled, setSubInputEnabled] = useState(false)
    const [subInputText, setSubInputText] = useState('')

    // FindInPage 状态
    const [searchText, setSearchText] = useState('')
    const [findResult, setFindResult] = useState<number | null>(null)

    // 子窗口状态 (支持多个子窗口)
    const [childWindows, setChildWindows] = useState<{ id: number; proxy: any; name: string }[]>([])
    const [childMessages, setChildMessages] = useState<string[]>([])

    // 文件拖拽状态
    const [dragFilePath, setDragFilePath] = useState<string>('')
    const [generatedTextPath, setGeneratedTextPath] = useState<string>('')
    const [generatedImagePath, setGeneratedImagePath] = useState<string>('')

    // 加载窗口信息
    const loadWindowInfo = useCallback(async () => {
        try {
            const type = await win.getWindowType()
            setWindowType(type || '-')

            const mode = await win.getMode()
            setWindowMode(mode || '-')

            const state = await win.getState()
            setWindowState(state)
        } catch (error) {
            console.error('[WindowAPI] Error loading window info:', error)
        }
    }, [win])

    useEffect(() => {
        loadWindowInfo()
    }, [loadWindowInfo])

    // 监听 SubInput 变化
    useEffect(() => {
        if (subInput.onChange) {
            subInput.onChange((data) => {
                setSubInputText(data.text)
            })
        }
    }, [subInput])

    // SubInput 操作
    const handleEnableSubInput = async () => {
        try {
            const result = await subInput.set('在这里输入内容...', true)
            if (result) {
                setSubInputEnabled(true)
                notify.success('子输入框已启用')
            }
        } catch (error) {
            notify.error('启用子输入框失败')
        }
    }

    const handleDisableSubInput = async () => {
        try {
            await subInput.remove()
            setSubInputEnabled(false)
            setSubInputText('')
            notify.success('子输入框已移除')
        } catch (error) {
            notify.error('移除子输入框失败')
        }
    }

    // 窗口操作
    const handleSetHeight = (height: number) => {
        win.setExpendHeight(height)
        notify.info(`窗口高度设置为 ${height}px`)
    }

    const handleDetach = () => {
        win.detach()
        notify.info('已请求分离为独立窗口')
    }

    const handleMinimize = () => {
        win.minimize()
    }

    const handleMaximize = () => {
        win.maximize()
        setTimeout(loadWindowInfo, 100)
    }

    // 页面内查找
    const handleFindInPage = async () => {
        if (!searchText.trim()) {
            notify.warning('请输入搜索内容')
            return
        }
        try {
            const requestId = await win.findInPage(searchText.trim())
            setFindResult(requestId)
            notify.info(`查找请求 ID: ${requestId}`)
        } catch (error) {
            notify.error('查找失败')
        }
    }

    const handleStopFind = () => {
        win.stopFindInPage('clearSelection')
        setFindResult(null)
        notify.info('已停止查找')
    }

    // 子窗口操作 - 支持创建多个
    const handleCreateChild = async () => {
        try {
            const childIndex = childWindows.length + 1
            const proxy = await win.create('/child-window', {
                width: 550,
                height: 380,
                title: `子窗口 #${childIndex}`
            })
            if (proxy) {
                setChildWindows(prev => [...prev, { id: proxy.id, proxy, name: `子窗口 #${childIndex}` }])
                notify.success(`子窗口 #${childIndex} 创建成功`)
            }
        } catch (error) {
            notify.error('创建子窗口失败')
        }
    }

    const handleChildAction = async (action: 'show' | 'hide' | 'close' | 'focus' | 'ping', childId?: number) => {
        const targetChild = childId
            ? childWindows.find(c => c.id === childId)
            : childWindows[childWindows.length - 1]
        if (!targetChild) return

        try {
            switch (action) {
                case 'show': await targetChild.proxy.show(); break
                case 'hide': await targetChild.proxy.hide(); break
                case 'close':
                    await targetChild.proxy.close()
                    setChildWindows(prev => prev.filter(c => c.id !== targetChild.id))
                    break
                case 'focus': await targetChild.proxy.focus(); break
                case 'ping':
                    await targetChild.proxy.postMessage('ping', `来自父窗口的消息 @${new Date().toLocaleTimeString()}`)
                    break
            }
        } catch (error) {
            console.error('Child action failed:', error)
        }
    }

    // 关闭所有子窗口
    const handleCloseAllChildren = async () => {
        for (const child of childWindows) {
            try { await child.proxy.close() } catch (e) { /* ignore */ }
        }
        setChildWindows([])
        setChildMessages([])
        notify.info('已关闭所有子窗口')
    }

    // 广播消息给所有子窗口
    const handleBroadcast = async () => {
        const msg = `广播消息 @${new Date().toLocaleTimeString()}`
        for (const child of childWindows) {
            try { await child.proxy.postMessage('broadcast', msg) } catch (e) { /* ignore */ }
        }
        notify.success(`已广播给 ${childWindows.length} 个子窗口`)
    }

    // 监听子窗口消息 + 转发逻辑
    useEffect(() => {
        const handleMessage = (channel: string, ...args: unknown[]) => {
            const timestamp = new Date().toLocaleTimeString()
            console.log('[WindowAPI] Received child message:', channel, args)
            setChildMessages(prev => [...prev.slice(-9), `[${timestamp}] ${channel}: ${JSON.stringify(args)}`])

            if (channel === 'child-event') {
                notify.info(`收到子窗口消息: ${args[0]}`)
            }

            // 处理转发请求 - 向其他所有子窗口广播
            if (channel === 'relay-request') {
                const data = args[0] as { from?: string; message?: string }
                childWindows.forEach(child => {
                    child.proxy.postMessage('relayed', {
                        originalFrom: data?.from,
                        message: data?.message,
                        relayedAt: timestamp
                    })
                })
                notify.info('已转发消息给所有子窗口')
            }
        }
        win.onChildMessage(handleMessage)
    }, [win, notify, childWindows])

    // 文件拖拽
    const handlePickDragFile = async () => {
        try {
            const files = await dialog.showOpenDialog({ properties: ['openFile'] })
            const filePath = files?.[0]
            if (filePath) {
                setDragFilePath(filePath)
                notify.success('已选择拖拽文件')
            }
        } catch (error) {
            notify.error('选择文件失败')
        }
    }

    const handleStartDrag = (filePath: string, event?: DragEvent<HTMLDivElement>) => {
        if (!filePath) {
            notify.warning('请先选择或生成文件')
            return
        }
        event?.preventDefault()
        try {
            win.startDrag(filePath)
        } catch (e) {
            notify.error('拖拽失败')
        }
    }

    const createTempFile = useCallback(async (type: 'text' | 'image') => {
        try {
            const tempDir = await system.getPath('temp')
            if (!tempDir) {
                notify.error('无法获取临时目录')
                return ''
            }
            const timestamp = Date.now()
            if (type === 'text') {
                const filePath = `${tempDir}/mulby-drag-${timestamp}.txt`
                const content = `Mulby Drag Demo\n${new Date(timestamp).toISOString()}`
                await filesystem.writeFile(filePath, content, 'utf-8')
                setGeneratedTextPath(filePath)
                notify.success('已生成临时文本文件')
                return filePath
            }
            const filePath = `${tempDir}/mulby-drag-${timestamp}.png`
            const base64Png =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOqz9uoAAAAASUVORK5CYII='
            await filesystem.writeFile(filePath, base64Png, 'base64')
            setGeneratedImagePath(filePath)
            notify.success('已生成临时图片文件')
            return filePath
        } catch (error) {
            notify.error('生成临时文件失败')
            return ''
        }
    }, [filesystem, system, notify])

    // 插件导航
    const handleOutPlugin = async (isKill: boolean) => {
        try {
            await plugin.outPlugin(isKill)
            notify.info(isKill ? '插件已关闭' : '插件已隐藏')
        } catch (error) {
            notify.error('操作失败')
        }
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="🪟"
                title="窗口 API"
                description="演示新增的窗口控制和 SubInput API"
                actions={<Button onClick={loadWindowInfo}>刷新状态</Button>}
            />
            <div className="page-content">
                {/* 窗口状态 */}
                <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div className="stat-item">
                        <div className="stat-icon">🏷️</div>
                        <div className="stat-value">{windowType}</div>
                        <div className="stat-label">窗口类型</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">📌</div>
                        <div className="stat-value">{windowMode}</div>
                        <div className="stat-label">插件模式</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">{windowState?.isMaximized ? '⬜' : '◻️'}</div>
                        <div className="stat-value">{windowState?.isMaximized ? '最大化' : '正常'}</div>
                        <div className="stat-label">窗口大小</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">{windowState?.isAlwaysOnTop ? '📍' : '📎'}</div>
                        <div className="stat-value">{windowState?.isAlwaysOnTop ? '置顶' : '普通'}</div>
                        <div className="stat-label">窗口层级</div>
                    </div>
                </div>

                <div className="grid grid-2">
                    {/* SubInput Card */}
                    <Card title="子输入框 (SubInput)" icon="⌨️">
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <StatusBadge status={subInputEnabled ? 'success' : 'info'}>
                                {subInputEnabled ? '已启用' : '未启用'}
                            </StatusBadge>
                        </div>
                        {subInputEnabled && subInputText && (
                            <div style={{ marginBottom: 'var(--spacing-md)', padding: 'var(--spacing-sm)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                                <strong>输入内容:</strong> {subInputText}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            {!subInputEnabled ? (
                                <Button onClick={handleEnableSubInput}>启用子输入框</Button>
                            ) : (
                                <>
                                    <Button variant="secondary" onClick={() => subInput.focus()}>聚焦</Button>
                                    <Button variant="secondary" onClick={() => subInput.select()}>全选</Button>
                                    <Button variant="secondary" onClick={handleDisableSubInput}>移除</Button>
                                </>
                            )}
                        </div>
                        <div style={{ marginTop: 'var(--spacing-md)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            启用后，主窗口搜索栏将变为插件的输入框，输入内容会实时显示在上方。
                        </div>
                    </Card>

                    {/* 窗口控制 */}
                    <Card title="窗口控制" icon="🎛️">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                <Button variant="secondary" onClick={() => handleSetHeight(300)}>高度 300</Button>
                                <Button variant="secondary" onClick={() => handleSetHeight(400)}>高度 400</Button>
                                <Button variant="secondary" onClick={() => handleSetHeight(500)}>高度 500</Button>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                <Button variant="secondary" onClick={handleMinimize}>最小化</Button>
                                <Button variant="secondary" onClick={handleMaximize}>最大化/还原</Button>
                                <Button onClick={handleDetach}>分离窗口</Button>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* 页面内查找 */}
                <Card title="页面内查找" icon="🔍">
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
                        <input
                            type="text"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="输入搜索内容..."
                            style={{
                                flex: 1,
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)'
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleFindInPage()}
                        />
                        <Button onClick={handleFindInPage}>查找</Button>
                        <Button variant="secondary" onClick={handleStopFind}>停止</Button>
                    </div>
                    {findResult !== null && (
                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            查找请求 ID: {findResult}
                        </div>
                    )}
                </Card>

                {/* 子窗口控制 */}
                <Card title="多子窗口控制" icon="👶">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                            <Button onClick={handleCreateChild}>创建子窗口 (+)</Button>
                            <Button variant="secondary" onClick={handleBroadcast} disabled={childWindows.length === 0}>
                                广播消息
                            </Button>
                            <Button variant="secondary" onClick={handleCloseAllChildren} disabled={childWindows.length === 0}>
                                关闭全部
                            </Button>
                        </div>

                        {childWindows.length > 0 && (
                            <div style={{ display: 'flex', gap: 'var(--spacing-xs)', flexWrap: 'wrap' }}>
                                {childWindows.map((child) => (
                                    <div key={child.id} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 8px',
                                        background: 'var(--bg-secondary)',
                                        borderRadius: 'var(--radius-sm)',
                                        fontSize: '12px'
                                    }}>
                                        <span>{child.name}</span>
                                        <button
                                            onClick={() => handleChildAction('ping', child.id)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px' }}
                                            title="发送消息"
                                        >📤</button>
                                        <button
                                            onClick={() => handleChildAction('close', child.id)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px' }}
                                            title="关闭"
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ padding: 'var(--spacing-sm)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                            <div style={{ marginBottom: 'var(--spacing-sm)', fontWeight: 'bold', fontSize: '12px' }}>
                                通信日志 (子窗口→父窗口):
                            </div>
                            <div style={{ maxHeight: '100px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace' }}>
                                {childMessages.length > 0 ? childMessages.map((m, i) => (
                                    <div key={i}>{m}</div>
                                )) : <span style={{ color: 'var(--text-tertiary)' }}>等待子窗口消息...</span>}
                            </div>
                        </div>

                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            💡 子窗口发送的消息只会到达直接父窗口，不会被兄弟窗口收到。
                            父窗口可通过"广播消息"将消息转发给所有子窗口。
                        </div>
                    </div>
                </Card>

                {/* 其他工具 */}
                <Card title="其他工具" icon="🛠️">
                    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>拖拽已有文件</div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
                                <Button variant="secondary" onClick={handlePickDragFile}>选择文件</Button>
                                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                    {dragFilePath || '未选择'}
                                </span>
                            </div>
                            <div
                                draggable
                                style={{
                                    width: '120px',
                                    height: '60px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px dashed var(--border-color)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'grab',
                                    userSelect: 'none'
                                }}
                                onDragStart={(e) => handleStartDrag(dragFilePath, e)}
                            >
                                <span>拖拽文件</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>拖拽生成内容</div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
                                <Button variant="secondary" onClick={() => createTempFile('text')}>生成文本</Button>
                                <Button variant="secondary" onClick={() => createTempFile('image')}>生成图片</Button>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                <div
                                    draggable
                                    style={{
                                        width: '120px',
                                        height: '60px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px dashed var(--border-color)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'grab',
                                        userSelect: 'none'
                                    }}
                                    onMouseDown={() => {
                                        if (!generatedTextPath) void createTempFile('text')
                                    }}
                                    onDragStart={(e) => handleStartDrag(generatedTextPath, e)}
                                >
                                    <span>拖拽文本</span>
                                </div>
                                <div
                                    draggable
                                    style={{
                                        width: '120px',
                                        height: '60px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px dashed var(--border-color)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'grab',
                                        userSelect: 'none'
                                    }}
                                    onMouseDown={() => {
                                        if (!generatedImagePath) void createTempFile('image')
                                    }}
                                    onDragStart={(e) => handleStartDrag(generatedImagePath, e)}
                                >
                                    <span>拖拽图片</span>
                                </div>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                生成内容会写入系统临时目录，然后通过路径拖拽。
                            </div>
                        </div>
                    </div>
                </Card>

                {/* 插件导航 */}
                <Card title="插件导航" icon="🚀">
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={() => handleOutPlugin(false)}>
                            退出插件 (隐藏)
                        </Button>
                        <Button variant="secondary" onClick={() => handleOutPlugin(true)}>
                            退出插件 (关闭)
                        </Button>
                        <Button variant="secondary" onClick={() => win.reload()}>
                            重新加载
                        </Button>
                    </div>
                    <div style={{ marginTop: 'var(--spacing-md)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        提示: redirect API 需要传入目标插件名称和功能代码，此处仅演示 outPlugin。
                    </div>
                </Card>

                {/* API 说明 */}
                <Card title="新增 API 说明" icon="📖">
                    <CodeBlock>
                        {`// 子输入框 API
await subInput.set('placeholder', true)  // 启用
await subInput.remove()                   // 移除
subInput.setValue('text')                 // 设置值
subInput.focus() / blur() / select()     // 焦点控制
subInput.onChange(({ text }) => {...})   // 监听变化

// 窗口控制
window.setExpendHeight(400)              // 设置高度
window.getWindowType()                   // 获取类型: main | detach
window.sendToParent(channel, ...args)    // 窗口通信
window.findInPage(text, options)         // 页面内查找
window.stopFindInPage(action)            // 停止查找
window.startDrag(filePath)               // 文件拖拽

// 插件导航
plugin.redirect('翻译', 'hello')         // 跳转插件
plugin.outPlugin(false)                  // 退出到后台
plugin.outPlugin(true)                   // 彻底关闭`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
