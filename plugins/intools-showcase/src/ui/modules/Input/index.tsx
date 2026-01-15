import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

export function InputModule() {
    const { input, dialog, system } = useIntools()
    const notify = useNotification()

    const [pasteText, setPasteText] = useState('')
    const [typeText, setTypeText] = useState('')
    const [busyAction, setBusyAction] = useState<string | null>(null)
    const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null)
    const [isMacOS, setIsMacOS] = useState<boolean>(false)

    const runAction = useCallback(async (name: string, action: () => Promise<boolean>) => {
        setBusyAction(name)
        try {
            const ok = await action()
            if (ok) {
                notify.success('已发送输入到目标应用')
            } else {
                notify.error('发送失败，请检查目标应用是否可接收输入')
            }
        } catch (error) {
            notify.error('执行失败，请确认权限与环境依赖')
        } finally {
            setBusyAction(null)
        }
    }, [notify])

    const loadAccessibilityStatus = useCallback(async () => {
        try {
            const mac = await system.isMacOS()
            setIsMacOS(Boolean(mac))
            if (mac) {
                const trusted = await system.isAccessibilityTrusted()
                setAccessibilityTrusted(Boolean(trusted))
            } else {
                setAccessibilityTrusted(true)
            }
        } catch {
            setAccessibilityTrusted(null)
        }
    }, [system])

    useEffect(() => {
        loadAccessibilityStatus()
    }, [loadAccessibilityStatus])

    const handlePasteText = async () => {
        if (!pasteText.trim()) {
            notify.warning('请输入要粘贴的文本')
            return
        }
        await runAction('pasteText', () => input.hideMainWindowPasteText(pasteText.trim()))
    }

    const handleTypeString = async () => {
        if (!typeText.trim()) {
            notify.warning('请输入要键入的内容')
            return
        }
        await runAction('typeString', () => input.hideMainWindowTypeString(typeText.trim()))
    }

    const handlePasteFile = async () => {
        const files = await dialog.showOpenDialog({
            title: '选择要粘贴的文件',
            properties: ['openFile', 'multiSelections']
        })
        if (!files || files.length === 0) return
        await runAction('pasteFile', () => input.hideMainWindowPasteFile(files))
    }

    const handlePasteImageFromPath = async () => {
        const files = await dialog.showOpenDialog({
            title: '选择要粘贴的图片',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
            properties: ['openFile']
        })
        if (!files || files.length === 0) return
        await runAction('pasteImagePath', () => input.hideMainWindowPasteImage(files[0]))
    }

    const handlePasteImageSample = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 120
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            notify.error('Canvas 不可用')
            return
        }
        ctx.fillStyle = '#0ea5e9'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#0f172a'
        ctx.font = '18px Arial'
        ctx.fillText('InTools Input', 12, 58)
        const dataUrl = canvas.toDataURL('image/png')
        await runAction('pasteImageSample', () => input.hideMainWindowPasteImage(dataUrl))
    }

    const handleOpenAccessibilitySettings = async () => {
        const ok = await system.openAccessibilitySettings()
        if (ok) {
            notify.info('已打开辅助功能设置')
        } else {
            notify.warning('当前系统不支持自动打开设置')
        }
    }

    const tutorialText = `// 文本粘贴
await input.hideMainWindowPasteText('Hello InTools')

// 图片粘贴 (路径 / DataURL / Buffer)
await input.hideMainWindowPasteImage('/path/to/image.png')

// 文件粘贴 (单个或数组)
await input.hideMainWindowPasteFile(['/path/a.txt', '/path/b.txt'])

// 模拟键入
await input.hideMainWindowTypeString('Typing...')`

    return (
        <div className="main-content">
            <PageHeader
                icon="⌨️"
                title="输入控制"
                description="隐藏主窗口并向外部应用发送粘贴或键入操作"
            />
            <div className="page-content">
                <Card title="权限检查" icon="✅" actions={
                    isMacOS ? (
                        <Button variant="secondary" onClick={handleOpenAccessibilitySettings}>
                            打开系统设置
                        </Button>
                    ) : null
                }>
                    {isMacOS ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                            <div style={{ color: 'var(--text-secondary)' }}>
                                当前状态：{accessibilityTrusted === null ? '未知' : (accessibilityTrusted ? '已授权' : '未授权')}
                            </div>
                            {!accessibilityTrusted && (
                                <div style={{ color: 'var(--warning)' }}>
                                    需要在“辅助功能”中允许 InTools/Electron 发送按键，才能模拟输入。
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-secondary)' }}>
                            非 macOS 平台无需辅助功能权限。
                        </div>
                    )}
                </Card>

                <Card title="使用教程" icon="📌">
                    <div style={{ display: 'grid', gap: '8px', color: 'var(--text-secondary)' }}>
                        <div>1. 在目标应用中放置光标（例如编辑器或聊天窗口）。</div>
                        <div>2. 切回 InTools Showcase，点击下方任一操作按钮。</div>
                        <div>3. 主窗口会自动隐藏并执行粘贴或键入。</div>
                        <div>4. macOS 需授予辅助功能权限；Linux 需安装 `xdotool`。</div>
                    </div>
                </Card>

                <Card title="粘贴文本" icon="📝" actions={
                    <Button onClick={handlePasteText} loading={busyAction === 'pasteText'}>
                        粘贴到目标应用
                    </Button>
                }>
                    <div className="input-group">
                        <label className="input-label">文本内容</label>
                        <input
                            className="input"
                            placeholder="输入要粘贴的文本"
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                        />
                    </div>
                </Card>

                <Card title="模拟键入" icon="⌨️" actions={
                    <Button onClick={handleTypeString} loading={busyAction === 'typeString'}>
                        发送键入
                    </Button>
                }>
                    <div className="input-group">
                        <label className="input-label">键入内容</label>
                        <input
                            className="input"
                            placeholder="输入要键入的文本"
                            value={typeText}
                            onChange={(e) => setTypeText(e.target.value)}
                        />
                    </div>
                </Card>

                <Card title="粘贴图片" icon="🖼️" actions={
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                        <Button variant="secondary" onClick={handlePasteImageFromPath} loading={busyAction === 'pasteImagePath'}>
                            从文件粘贴
                        </Button>
                        <Button variant="secondary" onClick={handlePasteImageSample} loading={busyAction === 'pasteImageSample'}>
                            发送示例图片
                        </Button>
                    </div>
                }>
                    <div style={{ color: 'var(--text-secondary)' }}>
                        图片将写入剪贴板后模拟粘贴，可用于聊天窗口或文档编辑器。
                    </div>
                </Card>

                <Card title="粘贴文件" icon="📎" actions={
                    <Button onClick={handlePasteFile} loading={busyAction === 'pasteFile'}>
                        选择文件并粘贴
                    </Button>
                }>
                    <div style={{ color: 'var(--text-secondary)' }}>
                        选择一个或多个文件，目标应用需支持文件粘贴（如文件管理器或聊天软件）。
                    </div>
                </Card>

                <Card title="API 用法示例" icon="🧩">
                    <CodeBlock>{tutorialText}</CodeBlock>
                </Card>
            </div>
        </div>
    )
}
