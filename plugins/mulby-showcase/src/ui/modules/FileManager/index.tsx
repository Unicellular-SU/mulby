import React, { useState, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface FileStat {
    name: string
    path: string
    size: number
    isFile: boolean
    isDirectory: boolean
    createdAt: number
    modifiedAt: number
}

export function FileManagerModule() {
    const { filesystem, dialog, shell } = useMulby()
    const notify = useNotification()

    const [selectedFile, setSelectedFile] = useState<string | null>(null)
    const [fileInfo, setFileInfo] = useState<FileStat | null>(null)
    const [fileContent, setFileContent] = useState<string | null>(null)
    const [dirContent, setDirContent] = useState<string[]>([])
    const [loading, setLoading] = useState(false)

    const handleOpenFile = useCallback(async () => {
        try {
            const files = await dialog.showOpenDialog({
                title: '选择文件',
                properties: ['openFile'],
                filters: [
                    { name: '所有文件', extensions: ['*'] },
                    { name: '文本文件', extensions: ['txt', 'md', 'json', 'js', 'ts'] },
                    { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                ],
            })

            if (files && files.length > 0) {
                const filePath = files[0]
                setSelectedFile(filePath)

                // Get file info
                const stat = await filesystem.stat(filePath)
                setFileInfo(stat)

                // Try to read as text
                try {
                    const content = await filesystem.readFile(filePath, 'utf-8')
                    if (typeof content === 'string' && content.length < 50000) {
                        setFileContent(content)
                    } else {
                        setFileContent('[文件过大或非文本格式]')
                    }
                } catch {
                    setFileContent('[无法读取文件内容]')
                }

                setDirContent([])
                notify.success('文件已选择')
            }
        } catch (error) {
            notify.error('打开文件失败')
        }
    }, [dialog, filesystem, notify])

    const handleOpenFolder = useCallback(async () => {
        try {
            const dirs = await dialog.showOpenDialog({
                title: '选择文件夹',
                properties: ['openDirectory'],
            })

            if (dirs && dirs.length > 0) {
                const dirPath = dirs[0]
                setSelectedFile(dirPath)

                // Get folder info
                const stat = await filesystem.stat(dirPath)
                setFileInfo(stat)

                // Read directory content
                const content = await filesystem.readdir(dirPath)
                setDirContent(content || [])
                setFileContent(null)

                notify.success('文件夹已选择')
            }
        } catch (error) {
            notify.error('打开文件夹失败')
        }
    }, [dialog, filesystem, notify])

    const handleSaveFile = useCallback(async () => {
        try {
            const savePath = await dialog.showSaveDialog({
                title: '保存文件',
                defaultPath: 'mulby-test.txt',
                filters: [
                    { name: '文本文件', extensions: ['txt'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            })

            if (savePath) {
                const content = `Mulby Showcase - 文件保存测试
时间: ${new Date().toLocaleString()}
这是一个测试文件，由 Mulby 插件创建。`

                await filesystem.writeFile(savePath, content, 'utf-8')
                notify.success(`文件已保存: ${savePath}`)
            }
        } catch (error) {
            notify.error('保存文件失败')
        }
    }, [dialog, filesystem, notify])

    const handleOpenInSystem = useCallback(async () => {
        if (!selectedFile) return
        try {
            await shell.openPath(selectedFile)
            notify.info('已使用系统应用打开')
        } catch (error) {
            notify.error('打开失败')
        }
    }, [shell, selectedFile, notify])

    const handleShowInFinder = useCallback(async () => {
        if (!selectedFile) return
        try {
            await shell.showItemInFolder(selectedFile)
            notify.info('已在文件管理器中显示')
        } catch (error) {
            notify.error('操作失败')
        }
    }, [shell, selectedFile, notify])

    const handleTrash = useCallback(async () => {
        if (!selectedFile) return

        const result = await dialog.showMessageBox({
            type: 'warning',
            title: '确认删除',
            message: `确定要将文件移动到废纸篓吗？`,
            detail: selectedFile,
            buttons: ['取消', '移到废纸篓'],
        })

        if (result?.response === 1) {
            try {
                await shell.trashItem(selectedFile)
                notify.success('已移动到废纸篓')
                setSelectedFile(null)
                setFileInfo(null)
                setFileContent(null)
            } catch (error) {
                notify.error('删除失败')
            }
        }
    }, [shell, dialog, selectedFile, notify])

    const handleOpenExternal = useCallback(async () => {
        try {
            await shell.openExternal('https://github.com')
            notify.info('已在浏览器中打开')
        } catch (error) {
            notify.error('打开失败')
        }
    }, [shell, notify])

    const handleMessageBox = useCallback(async () => {
        const result = await dialog.showMessageBox({
            type: 'question',
            title: '消息框测试',
            message: '这是一个测试消息框',
            detail: '你可以选择不同的按钮来测试返回值',
            buttons: ['取消', '选项A', '选项B'],
        })

        if (result) {
            notify.info(`你选择了按钮 ${result.response}`)
        }
    }, [dialog, notify])

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString()
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="📁"
                title="文件管理"
                description="文件操作、对话框和 Shell 功能"
            />
            <div className="page-content">
                {/* File Operations */}
                <Card title="文件操作" icon="📂">
                    <div className="action-bar">
                        <Button onClick={handleOpenFile}>打开文件</Button>
                        <Button onClick={handleOpenFolder}>打开文件夹</Button>
                        <Button variant="secondary" onClick={handleSaveFile}>保存测试文件</Button>
                    </div>
                </Card>

                {/* Selected File Info */}
                {selectedFile && (
                    <Card title="已选择" icon="📄">
                        <div className="info-grid">
                            <span className="info-label">路径</span>
                            <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                {selectedFile}
                            </span>

                            {fileInfo && (
                                <>
                                    <span className="info-label">类型</span>
                                    <span className="info-value">
                                        <StatusBadge status={fileInfo.isDirectory ? 'warning' : 'info'}>
                                            {fileInfo.isDirectory ? '文件夹' : '文件'}
                                        </StatusBadge>
                                    </span>

                                    <span className="info-label">大小</span>
                                    <span className="info-value">{formatFileSize(fileInfo.size)}</span>

                                    <span className="info-label">创建时间</span>
                                    <span className="info-value">{formatDate(fileInfo.createdAt)}</span>

                                    <span className="info-label">修改时间</span>
                                    <span className="info-value">{formatDate(fileInfo.modifiedAt)}</span>
                                </>
                            )}
                        </div>

                        <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                            <Button variant="secondary" onClick={handleOpenInSystem}>系统打开</Button>
                            <Button variant="secondary" onClick={handleShowInFinder}>在 Finder 中显示</Button>
                            <Button variant="secondary" onClick={handleTrash}>移到废纸篓</Button>
                        </div>
                    </Card>
                )}

                {/* Content Preview */}
                {fileContent && (
                    <Card title="文件内容预览" icon="👁️">
                        <CodeBlock>
                            {fileContent.length > 2000 ? fileContent.slice(0, 2000) + '\n...[已截断]' : fileContent}
                        </CodeBlock>
                    </Card>
                )}

                {/* Directory Content */}
                {dirContent.length > 0 && (
                    <Card title={`目录内容 (${dirContent.length} 项)`} icon="📑">
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                            gap: 'var(--spacing-sm)',
                        }}>
                            {dirContent.slice(0, 50).map((item, index) => (
                                <div
                                    key={index}
                                    style={{
                                        padding: 'var(--spacing-sm)',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-sm)',
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                    title={item}
                                >
                                    {item}
                                </div>
                            ))}
                            {dirContent.length > 50 && (
                                <div style={{ color: 'var(--text-tertiary)' }}>
                                    ...还有 {dirContent.length - 50} 项
                                </div>
                            )}
                        </div>
                    </Card>
                )}

                {/* Dialog Tests */}
                <Card title="对话框测试" icon="💬">
                    <div className="action-bar">
                        <Button variant="secondary" onClick={handleMessageBox}>消息框</Button>
                        <Button variant="secondary" onClick={handleOpenExternal}>打开外部链接</Button>
                    </div>
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 文件系统
filesystem.readFile(path, 'utf-8')
filesystem.writeFile(path, data, 'utf-8')
filesystem.stat(path)
filesystem.readdir(path)

// 对话框
dialog.showOpenDialog({ properties: ['openFile'] })
dialog.showSaveDialog({ defaultPath: 'file.txt' })
dialog.showMessageBox({ message: '...' })

// Shell
shell.openPath(path)
shell.showItemInFolder(path)
shell.openExternal(url)
shell.trashItem(path)`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
