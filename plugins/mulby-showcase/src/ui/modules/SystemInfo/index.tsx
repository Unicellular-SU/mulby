import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useMulby, useNotification } from '../../hooks'

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
    source?: 'native' | 'ip'
    timestamp: number
}

type NativeLocationTestState = {
    status: 'idle' | 'testing' | 'success' | 'failed'
    message: string
    checkedAt: number | null
}

export function SystemInfoModule() {
    console.log('[SystemInfo] Render')
    const { system, power, network, geolocation } = useMulby()
    const notify = useNotification()

    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
    const [paths, setPaths] = useState<Record<string, string>>({})
    const [isOnline, setIsOnline] = useState<boolean | null>(null)
    const [isOnBattery, setIsOnBattery] = useState<boolean | null>(null)
    const [idleTime, setIdleTime] = useState<number | null>(null)
    const [_thermalState, setThermalState] = useState<string | null>(null)
    const [position, setPosition] = useState<Position | null>(null)
    const [loading, setLoading] = useState(true)

    // 新增状态
    const [nativeId, setNativeId] = useState<string | null>(null)
    const [isDev, setIsDev] = useState<boolean | null>(null)
    const [platform, setPlatform] = useState<{ isMacOS: boolean; isWindows: boolean; isLinux: boolean } | null>(null)
    const [fileIcon, setFileIcon] = useState<string | null>(null)
    const [iconPath, setIconPath] = useState<string>('.txt')
    const [nativeLocationTest, setNativeLocationTest] = useState<NativeLocationTestState>({
        status: 'idle',
        message: '尚未测试',
        checkedAt: null
    })

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

            // System Paths (扩展支持 exe 和 logs)
            console.log('[SystemInfo] fetching paths...')
            const pathNames: ('desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'videos' | 'temp' | 'exe' | 'logs')[] =
                ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos', 'temp', 'exe', 'logs']
            const pathResults: Record<string, string> = {}
            for (const name of pathNames) {
                try {
                    const path = await system.getPath(name)
                    if (path) pathResults[name] = path
                } catch (e) {
                    console.warn(`[SystemInfo] Failed to get path: ${name}`, e)
                }
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

            // 新增 API 调用
            // getNativeId
            const deviceId = await system.getNativeId()
            console.log('[SystemInfo] got native id', deviceId)
            setNativeId(deviceId)

            // isDev
            const devMode = await system.isDev()
            console.log('[SystemInfo] isDev', devMode)
            setIsDev(devMode)

            // Platform detection
            const [mac, win, linux] = await Promise.all([
                system.isMacOS(),
                system.isWindows(),
                system.isLinux()
            ])
            console.log('[SystemInfo] platform', { mac, win, linux })
            setPlatform({ isMacOS: mac, isWindows: win, isLinux: linux })

            // getFileIcon (默认 .txt)
            const icon = await system.getFileIcon('.txt')
            console.log('[SystemInfo] got file icon')
            setFileIcon(icon)

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
        console.log('[SystemInfo] handleGetLocation called')
        try {
            // 先检查权限状态
            const status = await geolocation.getAccessStatus()
            console.log('[SystemInfo] Geolocation access status:', status)

            if (status === 'denied' || status === 'restricted') {
                notify.error('位置权限被拒绝，请在系统设置中开启')
                // 打开系统设置
                await geolocation.openSettings()
                return
            }

            if (status === 'not-determined') {
                // 请求权限
                const newStatus = await geolocation.requestAccess()
                console.log('[SystemInfo] Permission request result:', newStatus)
                if (newStatus !== 'granted') {
                    notify.error('位置权限未授权')
                    return
                }
            }

            // 获取位置
            console.log('[SystemInfo] Getting current position...')
            const pos = await geolocation.getCurrentPosition()
            console.log('[SystemInfo] Got position:', pos)
            if (pos) {
                setPosition(pos)
                notify.success('位置获取成功')
            }
        } catch (error) {
            console.error('[SystemInfo] Error getting location:', error)
            notify.error('获取位置失败: ' + (error instanceof Error ? error.message : String(error)))
        }
    }

    const handleTestNativeLocation = async () => {
        console.log('[SystemInfo] handleTestNativeLocation called')
        setNativeLocationTest({
            status: 'testing',
            message: '正在测试原生定位...',
            checkedAt: null
        })

        try {
            const status = await geolocation.getAccessStatus()
            if (!status) {
                throw new Error('地理位置 API 不可用')
            }

            if (status === 'denied' || status === 'restricted') {
                setNativeLocationTest({
                    status: 'failed',
                    message: '定位权限被拒绝或受限，无法验证原生定位',
                    checkedAt: Date.now()
                })
                notify.error('定位权限不可用，请在系统设置中开启')
                await geolocation.openSettings()
                return
            }

            if (status === 'not-determined') {
                const newStatus = await geolocation.requestAccess()
                if (newStatus !== 'granted') {
                    setNativeLocationTest({
                        status: 'failed',
                        message: '定位权限未授权，原生定位测试失败',
                        checkedAt: Date.now()
                    })
                    notify.error('位置权限未授权')
                    return
                }
            }

            const pos = await geolocation.getCurrentPosition()
            if (!pos) {
                throw new Error('未返回定位结果')
            }
            setPosition(pos)

            const accuracy = Number(pos.accuracy)
            const source = pos.source ?? (Number.isFinite(accuracy) && accuracy <= 100 ? 'native' : 'ip')
            if (source === 'native') {
                setNativeLocationTest({
                    status: 'success',
                    message: `原生定位可用（source=native，精度约 ${Number.isFinite(accuracy) ? accuracy.toFixed(0) : '未知'} 米）`,
                    checkedAt: Date.now()
                })
                notify.success('原生定位测试成功')
                return
            }

            const accuracyText = Number.isFinite(accuracy) ? `${accuracy.toFixed(0)} 米` : '未知'
            setNativeLocationTest({
                status: 'failed',
                message: `原生定位不可用（source=${source}，当前精度 ${accuracyText}）`,
                checkedAt: Date.now()
            })
            notify.error('原生定位测试失败')
        } catch (error) {
            console.error('[SystemInfo] Error testing native geolocation:', error)
            setNativeLocationTest({
                status: 'failed',
                message: error instanceof Error ? error.message : String(error),
                checkedAt: Date.now()
            })
            notify.error('原生定位测试失败')
        }
    }

    const nativeLocationStatusBadge: 'success' | 'warning' | 'error' | 'info' =
        nativeLocationTest.status === 'success'
            ? 'success'
            : nativeLocationTest.status === 'failed'
                ? 'error'
                : nativeLocationTest.status === 'testing'
                    ? 'warning'
                    : 'info'

    const handleGetFileIcon = async () => {
        try {
            const icon = await system.getFileIcon(iconPath)
            setFileIcon(icon)
            notify.success('图标获取成功')
        } catch (error) {
            notify.error('获取图标失败')
            console.error(error)
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
                        <div className="stat-icon">{isDev ? '🛠️' : '📦'}</div>
                        <div className="stat-value">{isDev ? '开发' : '生产'}</div>
                        <div className="stat-label">运行模式</div>
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

                {/* 新增: 设备标识与平台检测 */}
                <Card title="设备标识 & 平台检测" icon="🔑">
                    <div className="info-grid">
                        <span className="info-label">设备 ID</span>
                        <span className="info-value" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                            {nativeId || '-'}
                        </span>

                        <span className="info-label">开发模式</span>
                        <span className="info-value">
                            <StatusBadge status={isDev ? 'warning' : 'success'}>
                                {isDev ? '是 (isDev: true)' : '否 (isDev: false)'}
                            </StatusBadge>
                        </span>

                        <span className="info-label">平台检测</span>
                        <span className="info-value">
                            {platform && (
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <StatusBadge status={platform.isMacOS ? 'success' : 'info'}>
                                        macOS: {platform.isMacOS ? '✓' : '✗'}
                                    </StatusBadge>
                                    <StatusBadge status={platform.isWindows ? 'success' : 'info'}>
                                        Windows: {platform.isWindows ? '✓' : '✗'}
                                    </StatusBadge>
                                    <StatusBadge status={platform.isLinux ? 'success' : 'info'}>
                                        Linux: {platform.isLinux ? '✓' : '✗'}
                                    </StatusBadge>
                                </div>
                            )}
                        </span>
                    </div>
                </Card>

                {/* 新增: 文件图标 */}
                <Card title="文件图标 API" icon="🖼️">
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
                        <input
                            type="text"
                            value={iconPath}
                            onChange={(e) => setIconPath(e.target.value)}
                            placeholder="输入路径或扩展名 (如 .txt, folder)"
                            style={{
                                flex: 1,
                                padding: '8px 12px',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                fontSize: '13px'
                            }}
                        />
                        <Button onClick={handleGetFileIcon}>获取图标</Button>
                    </div>
                    <div className="info-grid">
                        <span className="info-label">图标预览</span>
                        <span className="info-value">
                            {fileIcon ? (
                                <img
                                    src={fileIcon}
                                    alt="File icon"
                                    style={{ width: '32px', height: '32px' }}
                                />
                            ) : '-'}
                        </span>
                        <span className="info-label">提示</span>
                        <span className="info-value" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            支持文件路径、扩展名（如 .txt、.pdf）或 "folder"
                        </span>
                    </div>
                </Card>

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
                    actions={
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Button variant="secondary" onClick={handleGetLocation}>获取位置</Button>
                            <Button onClick={handleTestNativeLocation} loading={nativeLocationTest.status === 'testing'}>
                                测试原生定位
                            </Button>
                        </div>
                    }
                >
                    <div className="info-grid">
                        <span className="info-label">原生定位测试</span>
                        <span className="info-value">
                            <StatusBadge status={nativeLocationStatusBadge}>
                                {nativeLocationTest.status === 'success' && '成功'}
                                {nativeLocationTest.status === 'failed' && '失败'}
                                {nativeLocationTest.status === 'testing' && '测试中'}
                                {nativeLocationTest.status === 'idle' && '未测试'}
                            </StatusBadge>
                        </span>

                        <span className="info-label">测试结果</span>
                        <span className="info-value">{nativeLocationTest.message}</span>

                        <span className="info-label">测试时间</span>
                        <span className="info-value">
                            {nativeLocationTest.checkedAt ? new Date(nativeLocationTest.checkedAt).toLocaleString() : '-'}
                        </span>

                        <span className="info-label">纬度</span>
                        <span className="info-value">{position ? position.latitude.toFixed(6) : '-'}</span>

                        <span className="info-label">经度</span>
                        <span className="info-value">{position ? position.longitude.toFixed(6) : '-'}</span>

                        <span className="info-label">精度</span>
                        <span className="info-value">{position ? `${position.accuracy.toFixed(0)} 米` : '-'}</span>

                        <span className="info-label">来源</span>
                        <span className="info-value">{position?.source ?? '-'}</span>

                        <span className="info-label">时间</span>
                        <span className="info-value">{position ? new Date(position.timestamp).toLocaleString() : '-'}</span>
                    </div>
                </Card>

                {/* Raw Data */}
                <Card title="原始数据" icon="📄">
                    <CodeBlock>
                        {JSON.stringify({ systemInfo, appInfo, paths, nativeId, isDev, platform }, null, 2)}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
