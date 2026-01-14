import { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

export function WindowAPIModule() {
    const { window: win, subInput, plugin } = useIntools()
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
