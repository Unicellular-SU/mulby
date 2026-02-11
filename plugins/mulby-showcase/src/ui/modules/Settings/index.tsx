import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useTheme, useMulby, useNotification } from '../../hooks'

interface ThemeInfo {
    mode: 'light' | 'dark' | 'system'
    actual: 'light' | 'dark'
}

export function SettingsModule() {
    const { theme } = useTheme()
    const { window: win, shortcut, tray, menu } = useMulby()
    const notify = useNotification()

    const [themeInfo, setThemeInfo] = useState<ThemeInfo | null>(null)
    const [windowWidth, setWindowWidth] = useState(800)
    const [windowHeight, setWindowHeight] = useState(600)
    const [registeredShortcuts, setRegisteredShortcuts] = useState<string[]>([])
    const [newShortcut, setNewShortcut] = useState('')
    const [trayExists, setTrayExists] = useState(false)
    const [lastTriggered, setLastTriggered] = useState<{ accelerator: string; count: number; time: Date } | null>(null)

    const loadThemeInfo = useCallback(async () => {
        try {
            const info = await window.mulby?.theme?.get()
            setThemeInfo(info ?? null)
        } catch (error) {
            console.error('Failed to get theme info:', error)
        }
    }, [])

    const checkTray = useCallback(async () => {
        try {
            const exists = await tray.exists()
            setTrayExists(exists ?? false)
        } catch (error) {
            console.error('Failed to check tray:', error)
        }
    }, [tray])

    useEffect(() => {
        loadThemeInfo()
        checkTray()
    }, [loadThemeInfo, checkTray])

    useEffect(() => {
        loadThemeInfo()
    }, [theme, loadThemeInfo])

    // 监听快捷键触发事件
    useEffect(() => {
        const handleShortcutTriggered = (accelerator: string) => {
            setLastTriggered(prev => ({
                accelerator,
                count: prev?.accelerator === accelerator ? prev.count + 1 : 1,
                time: new Date()
            }))
            notify.success(`🎯 快捷键触发: ${accelerator}`)
        }

        // 使用 mulby API 订阅快捷键触发事件
        window.mulby?.shortcut?.onTriggered?.(handleShortcutTriggered)

        // 注意：当前 onTriggered 没有返回取消订阅的函数，
        // 如果需要清理，可以在 preload 中添加 offTriggered 方法
    }, [notify])

    const handleThemeChange = useCallback(async (mode: 'light' | 'dark' | 'system') => {
        try {
            await window.mulby?.theme?.set(mode)
            loadThemeInfo()
            notify.success(`已切换到 ${mode === 'system' ? '跟随系统' : mode === 'dark' ? '暗色' : '亮色'} 主题`)
        } catch (error) {
            notify.error('切换主题失败')
        }
    }, [loadThemeInfo, notify])

    const handleSetWindowSize = useCallback(async () => {
        try {
            await win.setSize(windowWidth, windowHeight)
            notify.success(`窗口大小已设置为 ${windowWidth}x${windowHeight}`)
        } catch (error) {
            notify.error('设置窗口大小失败')
        }
    }, [win, windowWidth, windowHeight, notify])

    const handleHideWindow = useCallback(async () => {
        try {
            await win.hide()
        } catch (error) {
            notify.error('隐藏窗口失败')
        }
    }, [win, notify])

    const handleRegisterShortcut = useCallback(async () => {
        if (!newShortcut.trim()) {
            notify.warning('请输入快捷键')
            return
        }

        try {
            const success = await shortcut.register(newShortcut)
            if (success) {
                setRegisteredShortcuts(prev => [...prev, newShortcut])
                setNewShortcut('')
                notify.success(`快捷键 ${newShortcut} 已注册`)
            } else {
                notify.error('快捷键注册失败，可能已被占用')
            }
        } catch (error) {
            notify.error('注册失败')
        }
    }, [shortcut, newShortcut, notify])

    const handleUnregisterShortcut = useCallback(async (accelerator: string) => {
        try {
            await shortcut.unregister(accelerator)
            setRegisteredShortcuts(prev => prev.filter(s => s !== accelerator))
            notify.success(`快捷键 ${accelerator} 已注销`)
        } catch (error) {
            notify.error('注销失败')
        }
    }, [shortcut, notify])

    const handleUnregisterAll = useCallback(async () => {
        try {
            await shortcut.unregisterAll()
            setRegisteredShortcuts([])
            notify.success('已注销所有快捷键')
        } catch (error) {
            notify.error('注销失败')
        }
    }, [shortcut, notify])

    const handleCreateTray = useCallback(async () => {
        try {
            // 使用 base64 图标或本地图标
            const success = await tray.create({
                icon: 'https://via.placeholder.com/16',
                tooltip: 'Mulby Showcase',
                title: '🧰',
            })
            if (success) {
                setTrayExists(true)
                notify.success('托盘已创建')
            }
        } catch (error) {
            notify.error('创建托盘失败')
        }
    }, [tray, notify])

    const handleDestroyTray = useCallback(async () => {
        try {
            await tray.destroy()
            setTrayExists(false)
            notify.success('托盘已销毁')
        } catch (error) {
            notify.error('销毁托盘失败')
        }
    }, [tray, notify])

    const [isChecked, setIsChecked] = useState(true)

    const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
        e.preventDefault()
        try {
            const selectedId = await menu.showContextMenu([
                { label: '选项 1', id: 'opt1' },
                { label: '选项 2', id: 'opt2' },
                { type: 'separator' },
                {
                    label: '子菜单', id: 'submenu', submenu: [
                        { label: '子选项 A', id: 'sub-a' },
                        { label: '子选项 B', id: 'sub-b' },
                    ]
                },
                { type: 'separator' },
                { label: '禁用项', id: 'disabled', enabled: false },
                { label: '复选框', id: 'checkbox', type: 'checkbox', checked: isChecked },
            ])

            if (selectedId) {
                // 如果点击的是复选框，切换状态
                if (selectedId === 'checkbox') {
                    setIsChecked(prev => !prev)
                    notify.success(`复选框已${!isChecked ? '选中' : '取消'}`)
                } else {
                    notify.info(`你选择了: ${selectedId}`)
                }
            }
        } catch (error) {
            notify.error('显示菜单失败')
        }
    }, [menu, notify, isChecked])

    const presetSizes = [
        { label: '小', width: 600, height: 400 },
        { label: '中', width: 800, height: 600 },
        { label: '大', width: 1000, height: 700 },
        { label: '宽', width: 1200, height: 500 },
    ]

    const sampleShortcuts = [
        'CommandOrControl+Shift+X',
        'CommandOrControl+Shift+S',
        'Alt+Space',
        'F12',
    ]

    return (
        <div className="main-content">
            <PageHeader
                icon="⚙️"
                title="高级设置"
                description="主题、窗口、快捷键、托盘和菜单"
            />
            <div className="page-content">
                {/* Theme Settings */}
                <Card title="主题设置" icon="🎨">
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
                            {(['light', 'dark', 'system'] as const).map((mode) => (
                                <Button
                                    key={mode}
                                    variant={themeInfo?.mode === mode ? 'primary' : 'secondary'}
                                    onClick={() => handleThemeChange(mode)}
                                >
                                    {mode === 'light' ? '☀️ 亮色' : mode === 'dark' ? '🌙 暗色' : '💻 跟随系统'}
                                </Button>
                            ))}
                        </div>
                        {themeInfo && (
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                当前模式: <strong>{themeInfo.mode}</strong> |
                                实际主题: <StatusBadge status={themeInfo.actual === 'dark' ? 'info' : 'warning'}>
                                    {themeInfo.actual === 'dark' ? '暗色' : '亮色'}
                                </StatusBadge>
                            </div>
                        )}
                    </div>
                </Card>

                {/* Window Control */}
                <Card title="窗口控制" icon="🪟">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="action-bar">
                            {presetSizes.map((size) => (
                                <Button
                                    key={size.label}
                                    variant="secondary"
                                    onClick={() => {
                                        setWindowWidth(size.width)
                                        setWindowHeight(size.height)
                                    }}
                                >
                                    {size.label}
                                </Button>
                            ))}
                        </div>
                        <div className="input-row">
                            <div className="input-group" style={{ flex: 1 }}>
                                <label className="input-label">宽度</label>
                                <input
                                    className="input"
                                    type="number"
                                    value={windowWidth}
                                    onChange={(e) => setWindowWidth(parseInt(e.target.value) || 800)}
                                    min={400}
                                    max={2000}
                                />
                            </div>
                            <div className="input-group" style={{ flex: 1 }}>
                                <label className="input-label">高度</label>
                                <input
                                    className="input"
                                    type="number"
                                    value={windowHeight}
                                    onChange={(e) => setWindowHeight(parseInt(e.target.value) || 600)}
                                    min={300}
                                    max={1500}
                                />
                            </div>
                            <Button onClick={handleSetWindowSize} style={{ alignSelf: 'flex-end' }}>
                                应用
                            </Button>
                        </div>
                        <Button variant="secondary" onClick={handleHideWindow}>
                            隐藏窗口
                        </Button>
                    </div>
                </Card>

                {/* Global Shortcuts */}
                <Card title="全局快捷键" icon="⌨️">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {registeredShortcuts.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                                {registeredShortcuts.map((acc) => (
                                    <div
                                        key={acc}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            background: 'var(--bg-tertiary)',
                                            borderRadius: 'var(--radius-sm)',
                                        }}
                                    >
                                        <code style={{ fontFamily: 'monospace' }}>{acc}</code>
                                        <Button
                                            variant="secondary"
                                            onClick={() => handleUnregisterShortcut(acc)}
                                        >
                                            删除
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="input-row">
                            <input
                                className="input"
                                type="text"
                                value={newShortcut}
                                onChange={(e) => setNewShortcut(e.target.value)}
                                placeholder="例如: CommandOrControl+Shift+X"
                            />
                            <Button onClick={handleRegisterShortcut}>注册</Button>
                        </div>

                        <div className="action-bar">
                            {sampleShortcuts.map((acc) => (
                                <Button
                                    key={acc}
                                    variant="secondary"
                                    onClick={() => setNewShortcut(acc)}
                                >
                                    {acc.replace('CommandOrControl', 'Cmd')}
                                </Button>
                            ))}
                        </div>

                        {registeredShortcuts.length > 0 && (
                            <Button variant="secondary" onClick={handleUnregisterAll}>
                                注销所有快捷键
                            </Button>
                        )}

                        {/* 快捷键验证区域 */}
                        {registeredShortcuts.length > 0 && (
                            <div
                                style={{
                                    padding: 'var(--spacing-md)',
                                    background: lastTriggered ? 'var(--success-bg)' : 'var(--bg-tertiary)',
                                    borderRadius: 'var(--radius-md)',
                                    border: lastTriggered ? '1px solid var(--success-border)' : '1px dashed var(--border-secondary)',
                                    textAlign: 'center',
                                }}
                            >
                                {lastTriggered ? (
                                    <div>
                                        <p style={{ margin: 0, fontWeight: 600, color: 'var(--success-text)' }}>
                                            🎯 最后触发: <code style={{ fontFamily: 'monospace' }}>{lastTriggered.accelerator}</code>
                                        </p>
                                        <p style={{ margin: 'var(--spacing-xs) 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            触发次数: {lastTriggered.count} | 时间: {lastTriggered.time.toLocaleTimeString()}
                                        </p>
                                    </div>
                                ) : (
                                    <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '13px' }}>
                                        💡 注册快捷键后，按下快捷键验证是否生效
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </Card>

                {/* Tray */}
                <Card title="系统托盘" icon="🔔">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                        <div>
                            状态: <StatusBadge status={trayExists ? 'success' : 'info'}>
                                {trayExists ? '已创建' : '未创建'}
                            </StatusBadge>
                        </div>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={handleCreateTray} disabled={trayExists}>
                                创建托盘
                            </Button>
                            <Button variant="secondary" onClick={handleDestroyTray} disabled={!trayExists}>
                                销毁托盘
                            </Button>
                            <Button variant="secondary" onClick={checkTray}>
                                刷新状态
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* Context Menu */}
                <Card title="右键菜单" icon="📋">
                    <div
                        onContextMenu={handleContextMenu}
                        style={{
                            padding: 'var(--spacing-xl)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            textAlign: 'center',
                            cursor: 'context-menu',
                        }}
                    >
                        <p style={{ marginBottom: 'var(--spacing-sm)' }}>👆 在此区域右键点击测试菜单</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            支持普通项、分隔符、子菜单、复选框等
                        </p>
                    </div>
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 主题
const info = await theme.get()
await theme.set('dark')  // 'light' | 'dark' | 'system'

// 窗口
await window.setSize(800, 600)
await window.hide()

// 快捷键
await shortcut.register('Cmd+Shift+X')
await shortcut.unregister('Cmd+Shift+X')
await shortcut.unregisterAll()
shortcut.isRegistered('Cmd+Shift+X')

// 托盘
await tray.create({ icon, tooltip, title })
await tray.destroy()
await tray.exists()

// 右键菜单
const id = await menu.showContextMenu([
  { label: '选项', id: 'opt1' },
  { type: 'separator' },
  { label: '子菜单', submenu: [...] }
])`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
