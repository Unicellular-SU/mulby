import { useState, useEffect, useCallback, useRef } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

export function SecurityModule() {
    const { security, storage } = useMulby('mulby-showcase')
    const notify = useNotification()

    const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
    const [plainText, setPlainText] = useState('')
    const [encryptedData, setEncryptedData] = useState<string | null>(null)
    const [decryptedText, setDecryptedText] = useState<string | null>(null)

    const [storageKey, setStorageKey] = useState('showcase-test')
    const [storageValue, setStorageValue] = useState('')
    const [storedData, setStoredData] = useState<Record<string, unknown>>({})
    const [loading, setLoading] = useState(false)
    const storageFormRef = useRef<HTMLDivElement>(null)

    const checkEncryption = useCallback(async () => {
        try {
            const available = await security.isEncryptionAvailable()
            setEncryptionAvailable(available ?? null)
        } catch (error) {
            console.error('Failed to check encryption:', error)
        }
    }, [security])

    const loadStoredData = useCallback(async () => {
        try {
            // 加载一些预设的 key
            const keys = ['showcase-test', 'showcase-settings', 'showcase-history']
            const data: Record<string, unknown> = {}

            for (const key of keys) {
                const value = await storage.get(key)
                if (value !== null && value !== undefined) {
                    data[key] = value
                }
            }

            setStoredData(data)
        } catch (error) {
            console.error('Failed to load stored data:', error)
        }
    }, [storage])

    useEffect(() => {
        checkEncryption()
        loadStoredData()
    }, [checkEncryption, loadStoredData])

    const handleEncrypt = useCallback(async () => {
        if (!plainText.trim()) {
            notify.warning('请输入要加密的内容')
            return
        }

        setLoading(true)
        try {
            const encrypted = await security.encryptString(plainText)
            if (encrypted) {
                // 将 Buffer 转换为 Base64 字符串以便显示
                const base64 = btoa(
                    new Uint8Array(encrypted).reduce((data, byte) => data + String.fromCharCode(byte), '')
                )
                setEncryptedData(base64)
                setDecryptedText(null)
                notify.success('加密成功')
            }
        } catch (error) {
            notify.error('加密失败')
        } finally {
            setLoading(false)
        }
    }, [plainText, security, notify])

    const handleDecrypt = useCallback(async () => {
        if (!encryptedData) {
            notify.warning('没有可解密的数据')
            return
        }

        setLoading(true)
        try {
            // 将 Base64 字符串转换回 Buffer
            const binaryString = atob(encryptedData)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }

            const decrypted = await security.decryptString(bytes.buffer)
            if (decrypted) {
                setDecryptedText(decrypted)
                notify.success('解密成功')
            }
        } catch (error) {
            notify.error('解密失败')
        } finally {
            setLoading(false)
        }
    }, [encryptedData, security, notify])

    const handleStorageSave = useCallback(async () => {
        if (!storageKey.trim()) {
            notify.warning('请输入键名')
            return
        }

        try {
            // 尝试解析为 JSON，否则保存为字符串
            let value: unknown = storageValue
            try {
                value = JSON.parse(storageValue)
            } catch {
                // 保持为字符串
            }

            await storage.set(storageKey, value)
            notify.success(`已保存: ${storageKey}`)
            loadStoredData()
        } catch (error) {
            notify.error('保存失败')
        }
    }, [storageKey, storageValue, storage, notify, loadStoredData])

    const handleStorageLoad = useCallback(async () => {
        if (!storageKey.trim()) {
            notify.warning('请输入键名')
            return
        }

        try {
            const value = await storage.get(storageKey)
            if (value !== null && value !== undefined) {
                setStorageValue(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
                notify.success('已加载')
            } else {
                notify.info('该键不存在')
            }
        } catch (error) {
            notify.error('加载失败')
        }
    }, [storageKey, storage, notify])

    const handleStorageRemove = useCallback(async () => {
        if (!storageKey.trim()) {
            notify.warning('请输入键名')
            return
        }

        try {
            await storage.remove(storageKey)
            setStorageValue('')
            notify.success(`已删除: ${storageKey}`)
            loadStoredData()
        } catch (error) {
            notify.error('删除失败')
        }
    }, [storageKey, storage, notify, loadStoredData])

    const handleQuickSave = useCallback(async (key: string, value: unknown) => {
        try {
            await storage.set(key, value)
            notify.success(`已保存: ${key}`)
            loadStoredData()
        } catch (error) {
            notify.error('保存失败')
        }
    }, [storage, notify, loadStoredData])

    return (
        <div className="main-content">
            <PageHeader
                icon="🔐"
                title="安全与存储"
                description="加密功能和数据持久化"
            />
            <div className="page-content">
                {/* Encryption Status */}
                <Card title="加密功能" icon="🔒">
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            <span>加密可用:</span>
                            <StatusBadge status={encryptionAvailable ? 'success' : 'error'}>
                                {encryptionAvailable === null ? '检测中' : encryptionAvailable ? '支持' : '不支持'}
                            </StatusBadge>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: 'var(--spacing-xs)' }}>
                            使用系统级加密: macOS Keychain / Windows DPAPI / Linux Secret Service
                        </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="input-group">
                            <label className="input-label">明文</label>
                            <textarea
                                className="textarea"
                                value={plainText}
                                onChange={(e) => setPlainText(e.target.value)}
                                placeholder="输入要加密的内容，例如 API Key、密码等..."
                                rows={3}
                            />
                        </div>

                        <div className="action-bar">
                            <Button onClick={handleEncrypt} loading={loading} disabled={!encryptionAvailable}>
                                🔐 加密
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={handleDecrypt}
                                loading={loading}
                                disabled={!encryptedData}
                            >
                                🔓 解密
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setPlainText('')
                                    setEncryptedData(null)
                                    setDecryptedText(null)
                                }}
                            >
                                清空
                            </Button>
                        </div>

                        {encryptedData && (
                            <div className="input-group">
                                <label className="input-label">加密结果 (Base64)</label>
                                <CodeBlock>
                                    {encryptedData.length > 200
                                        ? encryptedData.slice(0, 200) + '...'
                                        : encryptedData}
                                </CodeBlock>
                            </div>
                        )}

                        {decryptedText && (
                            <div className="input-group">
                                <label className="input-label">解密结果</label>
                                <div style={{
                                    padding: 'var(--spacing-md)',
                                    background: 'var(--success-light)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--success)',
                                    fontFamily: 'monospace',
                                }}>
                                    {decryptedText}
                                </div>
                            </div>
                        )}
                    </div>
                </Card>

                <Card title="数据存储" icon="💾">
                    <div ref={storageFormRef} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="grid grid-2">
                            <div className="input-group">
                                <label className="input-label">键名</label>
                                <input
                                    className="input"
                                    type="text"
                                    value={storageKey}
                                    onChange={(e) => setStorageKey(e.target.value)}
                                    placeholder="例如: my-settings"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignSelf: 'flex-end' }}>
                                <Button variant="secondary" onClick={handleStorageLoad}>读取</Button>
                                <Button variant="secondary" onClick={handleStorageRemove}>删除</Button>
                            </div>
                        </div>

                        <div className="input-group">
                            <label className="input-label">值 (支持 JSON)</label>
                            <textarea
                                className="textarea"
                                value={storageValue}
                                onChange={(e) => setStorageValue(e.target.value)}
                                placeholder='例如: {"name": "test", "count": 42}'
                                rows={3}
                                style={{ fontFamily: 'monospace', fontSize: '12px' }}
                            />
                        </div>

                        <Button onClick={handleStorageSave}>保存</Button>
                    </div>
                </Card>

                {/* Quick Save Examples */}
                <Card title="快速保存示例" icon="⚡">
                    <div className="action-bar">
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickSave('showcase-settings', {
                                theme: 'dark',
                                language: 'zh-CN',
                                notifications: true,
                                timestamp: Date.now(),
                            })}
                        >
                            保存设置
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickSave('showcase-history', [
                                { action: 'screenshot', time: new Date().toISOString() },
                                { action: 'clipboard', time: new Date().toISOString() },
                            ])}
                        >
                            保存历史
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickSave('showcase-test', `测试数据 - ${new Date().toLocaleString()}`)}
                        >
                            保存字符串
                        </Button>
                    </div>
                </Card>

                {/* Stored Data */}
                <Card
                    title="已存储数据"
                    icon="📦"
                    actions={<Button variant="secondary" onClick={loadStoredData}>刷新</Button>}
                >
                    {Object.keys(storedData).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            {Object.entries(storedData).map(([key, value]) => (
                                <div
                                    key={key}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-sm)',
                                    }}
                                >
                                    <div style={{
                                        fontWeight: 500,
                                        marginBottom: 'var(--spacing-xs)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}>
                                        <code>{key}</code>
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                setStorageKey(key)
                                                setStorageValue(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
                                                storageFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                                notify.info('已加载到上方编辑区')
                                            }}
                                        >
                                            编辑
                                        </Button>
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--text-secondary)',
                                        fontFamily: 'monospace',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {typeof value === 'string' ? value : JSON.stringify(value)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <div>暂无存储数据</div>
                        </div>
                    )}
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 安全加密
const available = await security.isEncryptionAvailable()
const encrypted = await security.encryptString('明文')
const decrypted = await security.decryptString(encrypted)

// 存储
await storage.set('key', { foo: 'bar' })
const value = await storage.get('key')
await storage.remove('key')

// 加密存储示例
const apiKey = 'sk-xxxxxxxxxxxx'
const encrypted = await security.encryptString(apiKey)
await storage.set('encrypted_key', btoa(encrypted))

// 读取并解密
const stored = await storage.get('encrypted_key')
const buffer = atob(stored)
const decrypted = await security.decryptString(buffer)`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
