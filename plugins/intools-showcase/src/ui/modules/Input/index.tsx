import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

export function InputModule() {
    const { input, dialog, system, permission, screen } = useIntools()
    const notify = useNotification()

    const [pasteText, setPasteText] = useState('')
    const [typeText, setTypeText] = useState('')
    const [keyboardKey, setKeyboardKey] = useState('enter')
    const [keyboardModifiers, setKeyboardModifiers] = useState('')
    const [mouseX, setMouseX] = useState(100)
    const [mouseY, setMouseY] = useState(100)
    const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null)
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

    const runSimulateAction = useCallback(async (name: string, action: () => Promise<boolean>) => {
        setBusyAction(name)
        try {
            const ok = await action()
            if (ok) {
                notify.success('模拟操作已发送到目标应用')
            } else {
                notify.error('模拟操作失败，请确认权限与环境依赖')
            }
        } catch (error) {
            notify.error('模拟操作失败，请确认权限与环境依赖')
            console.error(error)
        } finally {
            setBusyAction(null)
        }
    }, [notify])

    const loadAccessibilityStatus = useCallback(async () => {
        try {
            const mac = await system.isMacOS()
            setIsMacOS(Boolean(mac))
            if (mac) {
                const trusted = await permission.isAccessibilityTrusted()
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

    // 模拟键盘按键
    const handleSimulateKeyboardTap = async () => {
        if (!keyboardKey.trim()) {
            notify.warning('请输入按键名称')
            return
        }
        const modifiers = keyboardModifiers.trim()
            ? keyboardModifiers.split(',').map(m => m.trim()).filter(Boolean)
            : []
        await runSimulateAction('keyboardTap', () =>
            input.simulateKeyboardTap(keyboardKey.trim(), ...modifiers)
        )
    }

    // 获取当前鼠标位置
    const handleGetMousePosition = async () => {
        try {
            const pos = await screen.getCursorScreenPoint()
            if (pos) {
                setCurrentMousePos(pos)
                setMouseX(pos.x)
                setMouseY(pos.y)
                notify.info(`当前鼠标位置: (${pos.x}, ${pos.y})`)
            }
        } catch (error) {
            notify.error('获取鼠标位置失败')
        }
    }

    // 模拟鼠标移动
    const handleSimulateMouseMove = async () => {
        await runSimulateAction('mouseMove', () => input.simulateMouseMove(mouseX, mouseY))
    }

    // 模拟鼠标左键单击
    const handleSimulateMouseClick = async () => {
        await runSimulateAction('mouseClick', () => input.simulateMouseClick(mouseX, mouseY))
    }

    // 模拟鼠标左键双击
    const handleSimulateMouseDoubleClick = async () => {
        await runSimulateAction('mouseDoubleClick', () => input.simulateMouseDoubleClick(mouseX, mouseY))
    }

    // 模拟鼠标右键点击
    const handleSimulateMouseRightClick = async () => {
        await runSimulateAction('mouseRightClick', () => input.simulateMouseRightClick(mouseX, mouseY))
    }

    const handleOpenAccessibilitySettings = async () => {
        const ok = await permission.openSystemSettings('accessibility')
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

    const simulateTutorialText = `// 模拟单个键
await input.simulateKeyboardTap('enter')

// 模拟组合键 (macOS 粘贴)
await input.simulateKeyboardTap('v', 'command')

// 模拟组合键 (Windows/Linux 粘贴)
await input.simulateKeyboardTap('v', 'ctrl')

// 多个修饰键组合 Ctrl+Shift+S
await input.simulateKeyboardTap('s', 'ctrl', 'shift')

// 鼠标移动到指定坐标
await input.simulateMouseMove(100, 100)

// 鼠标左键单击
await input.simulateMouseClick(150, 200)

// 鼠标左键双击
await input.simulateMouseDoubleClick(150, 200)

// 鼠标右键点击
await input.simulateMouseRightClick(200, 250)

// 获取当前鼠标位置
const pos = await screen.getCursorScreenPoint()
console.log(\`鼠标位置: (\${pos.x}, \${pos.y})\`)`

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
                        <div>1. <strong>打开目标应用</strong>（例如文本编辑器、浏览器、聊天窗口）。</div>
                        <div>2. <strong>在目标应用中放置光标</strong>，确保它是你希望接收输入的位置。</div>
                        <div>3. <strong>唤起 InTools</strong>（通过快捷键 Alt+Space）。</div>
                        <div>4. <strong>点击下方操作按钮</strong>，InTools 会自动隐藏并向目标应用发送操作。</div>
                        <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                            💡 <strong>原理</strong>：所有模拟操作都会先隐藏 InTools 窗口，让目标应用获得焦点，然后再执行模拟操作。
                        </div>
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

                <Card title="粘贴/键入 API 示例" icon="🧩">
                    <CodeBlock>{tutorialText}</CodeBlock>
                </Card>

                {/* 模拟按键部分 */}
                <div style={{ marginTop: '24px', marginBottom: '16px', fontWeight: 600, fontSize: '18px', color: 'var(--text-primary)' }}>
                    🎮 模拟按键与鼠标
                </div>

                <Card title="模拟操作说明" icon="💡">
                    <div style={{ display: 'grid', gap: '8px', color: 'var(--text-secondary)' }}>
                        <div>模拟按键和鼠标操作会<strong>先隐藏 InTools 窗口</strong>，让之前活跃的应用获得焦点，然后发送模拟操作。</div>
                        <div>这适用于以下场景：</div>
                        <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
                            <li>向编辑器发送快捷键（如 Ctrl+S 保存）</li>
                            <li>在表单中自动输入并提交（模拟 Enter）</li>
                            <li>自动化点击桌面上的某个位置</li>
                        </ul>
                    </div>
                </Card>

                <Card title="模拟键盘按键" icon="⌨️" actions={
                    <Button onClick={handleSimulateKeyboardTap} loading={busyAction === 'keyboardTap'}>
                        模拟按键
                    </Button>
                }>
                    <div style={{ display: 'grid', gap: '12px' }}>
                        <div className="input-group">
                            <label className="input-label">按键名称</label>
                            <input
                                className="input"
                                placeholder="如: enter, a, f5, space"
                                value={keyboardKey}
                                onChange={(e) => setKeyboardKey(e.target.value)}
                            />
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                支持: a-z, 0-9, enter, tab, space, backspace, delete, escape, up/down/left/right, f1-f12 等
                            </div>
                        </div>
                        <div className="input-group">
                            <label className="input-label">修饰键（可选，逗号分隔）</label>
                            <input
                                className="input"
                                placeholder="如: ctrl 或 ctrl,shift 或 command"
                                value={keyboardModifiers}
                                onChange={(e) => setKeyboardModifiers(e.target.value)}
                            />
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                支持: ctrl, alt, shift, command (macOS), meta, super, win
                            </div>
                        </div>
                    </div>
                </Card>

                <Card title="模拟鼠标操作" icon="🖱️" actions={
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={handleGetMousePosition}>
                            获取鼠标位置
                        </Button>
                        <Button variant="secondary" onClick={handleSimulateMouseMove} loading={busyAction === 'mouseMove'}>
                            移动鼠标
                        </Button>
                        <Button onClick={handleSimulateMouseClick} loading={busyAction === 'mouseClick'}>
                            左键单击
                        </Button>
                        <Button variant="secondary" onClick={handleSimulateMouseDoubleClick} loading={busyAction === 'mouseDoubleClick'}>
                            左键双击
                        </Button>
                        <Button variant="secondary" onClick={handleSimulateMouseRightClick} loading={busyAction === 'mouseRightClick'}>
                            右键点击
                        </Button>
                    </div>
                }>
                    <div style={{ display: 'grid', gap: '12px' }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <div className="input-group" style={{ flex: 1 }}>
                                <label className="input-label">X 坐标</label>
                                <input
                                    className="input"
                                    type="number"
                                    placeholder="X"
                                    value={mouseX}
                                    onChange={(e) => setMouseX(Number(e.target.value))}
                                />
                            </div>
                            <div className="input-group" style={{ flex: 1 }}>
                                <label className="input-label">Y 坐标</label>
                                <input
                                    className="input"
                                    type="number"
                                    placeholder="Y"
                                    value={mouseY}
                                    onChange={(e) => setMouseY(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        {currentMousePos && (
                            <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '6px', fontSize: '14px' }}>
                                当前鼠标位置: <strong>({currentMousePos.x}, {currentMousePos.y})</strong>
                            </div>
                        )}
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            坐标以屏幕左上角为原点，单位为像素。点击"获取鼠标位置"可以获取当前鼠标坐标。
                        </div>
                    </div>
                </Card>

                <Card title="常用快捷键示例" icon="⚡">
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('copy', () => input.simulateKeyboardTap('c', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'copy'}
                        >
                            复制 (Cmd/Ctrl+C)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('paste', () => input.simulateKeyboardTap('v', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'paste'}
                        >
                            粘贴 (Cmd/Ctrl+V)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('cut', () => input.simulateKeyboardTap('x', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'cut'}
                        >
                            剪切 (Cmd/Ctrl+X)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('save', () => input.simulateKeyboardTap('s', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'save'}
                        >
                            保存 (Cmd/Ctrl+S)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('undo', () => input.simulateKeyboardTap('z', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'undo'}
                        >
                            撤销 (Cmd/Ctrl+Z)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('selectAll', () => input.simulateKeyboardTap('a', isMacOS ? 'command' : 'ctrl'))}
                            loading={busyAction === 'selectAll'}
                        >
                            全选 (Cmd/Ctrl+A)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('enter', () => input.simulateKeyboardTap('enter'))}
                            loading={busyAction === 'enter'}
                        >
                            回车 (Enter)
                        </Button>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => runSimulateAction('escape', () => input.simulateKeyboardTap('escape'))}
                            loading={busyAction === 'escape'}
                        >
                            取消 (Escape)
                        </Button>
                    </div>
                </Card>

                <Card title="模拟按键 API 示例" icon="📖">
                    <CodeBlock>{simulateTutorialText}</CodeBlock>
                </Card>

                <Card title="注意事项" icon="⚠️">
                    <div style={{ display: 'grid', gap: '8px', color: 'var(--text-secondary)' }}>
                        <div><strong>macOS:</strong> 需要在系统偏好设置中授予辅助功能权限。</div>
                        <div><strong>Windows:</strong> 某些受保护的应用可能无法接收模拟输入。</div>
                        <div><strong>Linux:</strong> 依赖 xdotool 工具，Wayland 环境可能受限。</div>
                        <div><strong>坐标系统:</strong> 鼠标坐标以整个屏幕左上角为原点，多显示器环境下需注意坐标计算。</div>
                    </div>
                </Card>
            </div>
        </div>
    )
}
