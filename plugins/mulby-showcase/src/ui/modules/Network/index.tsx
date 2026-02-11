import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface HttpResponse {
    status: number
    statusText: string
    headers: Record<string, string>
    data: string
}

export function NetworkModule() {
    const { http, network } = useMulby()
    const notify = useNotification()

    const [isOnline, setIsOnline] = useState<boolean | null>(null)
    const [url, setUrl] = useState('https://httpbin.org/get')
    const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET')
    const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}')
    const [body, setBody] = useState('{\n  "key": "value"\n}')
    const [response, setResponse] = useState<HttpResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [responseTime, setResponseTime] = useState<number | null>(null)

    const checkOnline = useCallback(async () => {
        const online = await network.isOnline()
        setIsOnline(online ?? null)
    }, [network])

    useEffect(() => {
        checkOnline()

        // 监听网络状态变化
        window.mulby?.network?.onOnline?.(() => {
            setIsOnline(true)
            notify.success('网络已恢复')
        })

        window.mulby?.network?.onOffline?.(() => {
            setIsOnline(false)
            notify.warning('网络已断开')
        })
    }, [checkOnline, notify])

    const handleRequest = useCallback(async () => {
        if (!url.trim()) {
            notify.warning('请输入 URL')
            return
        }

        setLoading(true)
        setResponse(null)
        const startTime = Date.now()

        try {
            let headersObj: Record<string, string> = {}
            try {
                headersObj = JSON.parse(headers)
            } catch {
                // 忽略解析错误
            }

            let bodyObj: unknown = undefined
            if (method === 'POST' || method === 'PUT') {
                try {
                    bodyObj = JSON.parse(body)
                } catch {
                    bodyObj = body
                }
            }

            const result = await http.request({
                url,
                method,
                headers: headersObj,
                body: bodyObj,
                timeout: 30000,
            })

            setResponseTime(Date.now() - startTime)
            setResponse(result)
            notify.success(`请求成功: ${result?.status}`)
        } catch (error) {
            setResponseTime(Date.now() - startTime)
            notify.error(`请求失败: ${error}`)
        } finally {
            setLoading(false)
        }
    }, [url, method, headers, body, http, notify])

    const handleQuickTest = useCallback(async (testUrl: string, testMethod: 'GET' | 'POST' = 'GET') => {
        setUrl(testUrl)
        setMethod(testMethod)
        setLoading(true)
        setResponse(null)
        const startTime = Date.now()

        try {
            const result = testMethod === 'GET'
                ? await http.get(testUrl)
                : await http.post(testUrl, { test: true, timestamp: Date.now() })

            setResponseTime(Date.now() - startTime)
            setResponse(result)
            notify.success(`请求成功: ${result?.status}`)
        } catch (error) {
            setResponseTime(Date.now() - startTime)
            notify.error(`请求失败: ${error}`)
        } finally {
            setLoading(false)
        }
    }, [http, notify])

    const formatJson = (str: string) => {
        try {
            return JSON.stringify(JSON.parse(str), null, 2)
        } catch {
            return str
        }
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="🌐"
                title="网络与 HTTP"
                description="HTTP 请求测试和网络状态监控"
            />
            <div className="page-content">
                {/* Network Status */}
                <Card title="网络状态" icon="📶">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            <span style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: isOnline ? 'var(--success)' : 'var(--error)',
                            }} />
                            <span style={{ fontWeight: 500 }}>
                                {isOnline === null ? '检测中...' : isOnline ? '在线' : '离线'}
                            </span>
                        </div>
                        <Button variant="secondary" onClick={checkOnline}>刷新状态</Button>
                    </div>
                </Card>

                {/* Quick Tests */}
                <Card title="快速测试" icon="⚡">
                    <div className="action-bar">
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickTest('https://httpbin.org/get')}
                            loading={loading && url === 'https://httpbin.org/get'}
                        >
                            GET 测试
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickTest('https://httpbin.org/post', 'POST')}
                            loading={loading && url === 'https://httpbin.org/post'}
                        >
                            POST 测试
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickTest('https://httpbin.org/ip')}
                            loading={loading && url === 'https://httpbin.org/ip'}
                        >
                            获取 IP
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => handleQuickTest('https://httpbin.org/headers')}
                            loading={loading && url === 'https://httpbin.org/headers'}
                        >
                            查看 Headers
                        </Button>
                    </div>
                </Card>

                {/* Custom Request */}
                <Card title="自定义请求" icon="📝">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div className="input-row">
                            <select
                                className="select"
                                value={method}
                                onChange={(e) => setMethod(e.target.value as 'GET' | 'POST' | 'PUT' | 'DELETE')}
                                style={{ width: 100 }}
                            >
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="DELETE">DELETE</option>
                            </select>
                            <input
                                className="input"
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="输入 URL"
                            />
                            <Button onClick={handleRequest} loading={loading}>
                                发送
                            </Button>
                        </div>

                        {(method === 'POST' || method === 'PUT') && (
                            <div className="input-group">
                                <label className="input-label">请求体 (JSON)</label>
                                <textarea
                                    className="textarea"
                                    value={body}
                                    onChange={(e) => setBody(e.target.value)}
                                    rows={4}
                                    style={{ fontFamily: 'monospace', fontSize: '12px' }}
                                />
                            </div>
                        )}

                        <div className="input-group">
                            <label className="input-label">请求头 (JSON)</label>
                            <textarea
                                className="textarea"
                                value={headers}
                                onChange={(e) => setHeaders(e.target.value)}
                                rows={3}
                                style={{ fontFamily: 'monospace', fontSize: '12px' }}
                            />
                        </div>
                    </div>
                </Card>

                {/* Response */}
                {response && (
                    <Card
                        title="响应结果"
                        icon="📥"
                        actions={
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
                                {responseTime !== null && (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                        {responseTime} ms
                                    </span>
                                )}
                                <StatusBadge status={response.status < 400 ? 'success' : 'error'}>
                                    {response.status} {response.statusText}
                                </StatusBadge>
                            </div>
                        }
                    >
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <div className="input-label" style={{ marginBottom: 'var(--spacing-xs)' }}>响应头</div>
                            <CodeBlock>
                                {JSON.stringify(response.headers, null, 2)}
                            </CodeBlock>
                        </div>
                        <div>
                            <div className="input-label" style={{ marginBottom: 'var(--spacing-xs)' }}>响应体</div>
                            <CodeBlock>
                                {formatJson(response.data).slice(0, 5000)}
                                {response.data.length > 5000 ? '\n...[已截断]' : ''}
                            </CodeBlock>
                        </div>
                    </Card>
                )}

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 完整请求
const response = await http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: { key: 'value' },
  timeout: 5000
})

// 快捷方法
await http.get(url, headers?)
await http.post(url, body?, headers?)
await http.put(url, body?, headers?)
await http.delete(url, headers?)

// 网络状态
const isOnline = await network.isOnline()
network.onOnline(() => console.log('在线'))
network.onOffline(() => console.log('离线'))`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
