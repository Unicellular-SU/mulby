import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

interface SystemInfo {
    platform: string
    arch: string
    hostname: string
    username: string
    homedir: string
    tmpdir: string
    cpus: number
    totalmem: number
    freemem: number
    uptime: number
    osVersion: string
    osRelease: string
}

interface AppInfo {
    name: string
    version: string
    locale: string
    isPackaged: boolean
    userDataPath: string
}

interface Position {
    latitude: number
    longitude: number
    accuracy: number
    timestamp: number
}

export function SystemInfoModule() {
    console.log('[SystemInfo] Render')
    const { system, power, network, geolocation } = useIntools()
    const notify = useNotification()

    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
    const [paths, setPaths] = useState<Record<string, string>>({})
    const [isOnline, setIsOnline] = useState<boolean | null>(null)
    const [isOnBattery, setIsOnBattery] = useState<boolean | null>(null)
    const [idleTime, setIdleTime] = useState<number | null>(null)
    const [thermalState, setThermalState] = useState<string | null>(null)
    const [position, setPosition] = useState<Position | null>(null)
    const [loading, setLoading] = useState(true)

    const loadData = useCallback(async () => {
        console.log('[SystemInfo] loadData start')
        setLoading(true)
        try {
            // System Info
            console.log('[SystemInfo] fetching system info...')
            const sysInfo = await system.getSystemInfo()
            console.log('[SystemInfo] got system info', sysInfo)
            if (sysInfo) setSystemInfo(sysInfo)

            // App Info
            console.log('[SystemInfo] fetching app info...')
            const app = await system.getAppInfo()
            console.log('[SystemInfo] got app info', app)
            if (app) setAppInfo(app)

            // System Paths
            console.log('[SystemInfo] fetching paths...')
            const pathNames: ('desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'videos' | 'temp')[] = ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos', 'temp']
            const pathResults: Record<string, string> = {}
            for (const name of pathNames) {
                const path = await system.getPath(name)
                if (path) pathResults[name] = path
            }
            console.log('[SystemInfo] got paths', pathResults)
            setPaths(pathResults)

            // Network Status
            console.log('[SystemInfo] fetching network status...')
            const online = await network.isOnline()
            console.log('[SystemInfo] got online status', online)
            setIsOnline(online ?? null)

            // Power Status
            console.log('[SystemInfo] fetching power status...')
            const battery = await power.isOnBatteryPower()
            console.log('[SystemInfo] got battery status', battery)
            setIsOnBattery(battery ?? null)

            const thermal = await power.getCurrentThermalState()
            console.log('[SystemInfo] got thermal state', thermal)
            setThermalState(thermal ?? null)

            // Idle Time
            const idle = await power.getSystemIdleTime()
            console.log('[SystemInfo] got idle time', idle)
            setIdleTime(idle ?? null)

        } catch (error) {
            console.error('[SystemInfo] Error loading data:', error)
            notify.error('加载系统信息失败')
            console.error(error)
        } finally {
            console.log('[SystemInfo] loadData finished')
            setLoading(false)
        }
    }, [system, power, network, notify])

    useEffect(() => {
        console.log('[SystemInfo] Effect trigger loadData')
        loadData()
    }, [loadData])

    const handleGetLocation = async () => {
        try {
            const pos = await geolocation.getCurrentPosition()
            if (pos) {
                setPosition(pos)
                notify.success('位置获取成功')
            }
        } catch (error) {
            notify.error('获取位置失败')
        }
    }

    const formatBytes = (bytes: number) => {
        const gb = bytes / 1024 / 1024 / 1024
        return `${gb.toFixed(2)} GB`
    }

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        const mins = Math.floor((seconds % 3600) / 60)
        return `${days}天 ${hours}小时 ${mins}分钟`
    }

    if (loading) {
        return (
            <div className="main-content">
                <PageHeader icon="📊" title="系统信息" description="查看系统、应用和环境信息" />
                <div className="page-content">
                    <div className="loading">
                        <span className="spinner" />
                        <span>加载中...</span>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="📊"
                title="系统信息"
                description="查看系统、应用和环境信息"
                actions={<Button onClick={loadData}>刷新</Button>}
            />
            <div className="page-content">
                {/* Status Cards */}
                <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div className="stat-item">
                        <div className="stat-icon">{isOnline ? '🌐' : '📴'}</div>
                        <div className="stat-value">{isOnline ? '在线' : '离线'}</div>
                        <div className="stat-label">网络状态</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">{isOnBattery ? '🔋' : '🔌'}</div>
                        <div className="stat-value">{isOnBattery ? '电池' : '电源'}</div>
                        <div className="stat-label">供电状态</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">⏱️</div>
                        <div className="stat-value">{idleTime !== null ? `${idleTime}s` : '-'}</div>
                        <div className="stat-label">空闲时间</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-icon">🌡️</div>
                        <div className="stat-value">{thermalState || '-'}</div>
                        <div className="stat-label">热状态</div>
                    </div>
                </div>

                <div className="grid grid-2">
                    {/* System Info Card */}
                    <Card title="操作系统" icon="💻">
                        {systemInfo && (
                            <div className="info-grid">
                                <span className="info-label">平台</span>
                                <span className="info-value">{systemInfo.platform}</span>

                                <span className="info-label">架构</span>
                                <span className="info-value">{systemInfo.arch}</span>

                                <span className="info-label">版本</span>
                                <span className="info-value">{systemInfo.osVersion}</span>

                                <span className="info-label">主机名</span>
                                <span className="info-value">{systemInfo.hostname}</span>

                                <span className="info-label">用户</span>
                                <span className="info-value">{systemInfo.username}</span>

                                <span className="info-label">CPU核心</span>
                                <span className="info-value">{systemInfo.cpus} 核</span>

                                <span className="info-label">总内存</span>
                                <span className="info-value">{formatBytes(systemInfo.totalmem)}</span>

                                <span className="info-label">可用内存</span>
                                <span className="info-value">{formatBytes(systemInfo.freemem)}</span>

                                <span className="info-label">运行时间</span>
                                <span className="info-value">{formatUptime(systemInfo.uptime)}</span>
                            </div>
                        )}
                    </Card>

                    {/* App Info Card */}
                    <Card title="应用信息" icon="📱">
                        {appInfo && (
                            <div className="info-grid">
                                <span className="info-label">名称</span>
                                <span className="info-value">{appInfo.name}</span>

                                <span className="info-label">版本</span>
                                <span className="info-value">{appInfo.version}</span>

                                <span className="info-label">语言</span>
                                <span className="info-value">{appInfo.locale}</span>

                                <span className="info-label">打包</span>
                                <span className="info-value">
                                    <StatusBadge status={appInfo.isPackaged ? 'success' : 'info'}>
                                        {appInfo.isPackaged ? '已打包' : '开发模式'}
                                    </StatusBadge>
                                </span>

                                <span className="info-label">数据目录</span>
                                <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                    {appInfo.userDataPath}
                                </span>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Paths Card */}
                <Card title="系统路径" icon="📂">
                    <div className="info-grid">
                        {Object.entries(paths).map(([name, path]) => (
                            <React.Fragment key={name}>
                                <span className="info-label">{name}</span>
                                <span className="info-value" style={{ fontSize: '11px' }}>{path}</span>
                            </React.Fragment>
                        ))}
                    </div>
                </Card>

                {/* Geolocation Card */}
                <Card
                    title="地理位置"
                    icon="📍"
                    actions={<Button variant="secondary" onClick={handleGetLocation}>获取位置</Button>}
                >
                    {position ? (
                        <div className="info-grid">
                            <span className="info-label">纬度</span>
                            <span className="info-value">{position.latitude.toFixed(6)}</span>

                            <span className="info-label">经度</span>
                            <span className="info-value">{position.longitude.toFixed(6)}</span>

                            <span className="info-label">精度</span>
                            <span className="info-value">{position.accuracy.toFixed(0)} 米</span>

                            <span className="info-label">时间</span>
                            <span className="info-value">{new Date(position.timestamp).toLocaleString()}</span>
                        </div>
                    ) : (
                        <div className="empty-state">
                            <div>点击"获取位置"按钮获取当前位置</div>
                        </div>
                    )}
                </Card>

                {/* Raw Data */}
                <Card title="原始数据" icon="📄">
                    <CodeBlock>
                        {JSON.stringify({ systemInfo, appInfo, paths }, null, 2)}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
