import { systemPreferences, session, app } from 'electron'
import log from 'electron-log'

type MacPermissionsModule = {
    getAuthStatus: (type: string) => string
    [key: string]: unknown
}

// 仅在 macOS 上加载原生模块
let permissions: MacPermissionsModule | null = null
if (process.platform === 'darwin') {
    try {
        permissions = require('node-mac-permissions') as MacPermissionsModule
        log.info('[PermissionManager] Loaded node-mac-permissions')
    } catch (error) {
        log.warn('[PermissionManager] Failed to load node-mac-permissions:', error)
    }
}

export type PermissionType =
    | 'geolocation'
    | 'camera'
    | 'microphone'
    | 'notifications'
    | 'screen'
    | 'accessibility'
    | 'contacts'
    | 'calendar'

export type PermissionStatus =
    | 'authorized'     // 已授权 (macOS 术语)
    | 'granted'        // 已授权 (通用术语)
    | 'denied'         // 已拒绝
    | 'not-determined' // 未决定
    | 'restricted'     // 受限（系统策略）
    | 'limited'        // 受限访问
    | 'unknown'        // 无法确定

// 将 node-mac-permissions 状态标准化
function normalizeStatus(status: string): PermissionStatus {
    switch (status) {
        case 'authorized':
            return 'granted'
        case 'denied':
            return 'denied'
        case 'not determined':
        case 'not-determined':
            return 'not-determined'
        case 'restricted':
            return 'restricted'
        case 'limited':
            return 'limited'
        default:
            return 'unknown'
    }
}

// 将 PermissionType 映射到 node-mac-permissions 的类型
function mapToMacPermissionType(type: PermissionType): string | null {
    const mapping: Record<PermissionType, string | null> = {
        'geolocation': 'location',
        'camera': 'camera',
        'microphone': 'microphone',
        'notifications': 'notifications',
        'screen': 'screen',
        'accessibility': 'accessibility',
        'contacts': 'contacts',
        'calendar': 'calendar',
    }
    return mapping[type] || null
}

export class PermissionManager {
    private static instance: PermissionManager
    private sessionHandlerSetup = false
    private geolocationStatusOverride: PermissionStatus | null = null

    private constructor() {
        log.info('[PermissionManager] Initializing...')
        log.info(`[PermissionManager] Platform: ${process.platform}`)
        log.info(`[PermissionManager] node-mac-permissions loaded: ${permissions !== null}`)

        // 延迟设置 Electron 权限处理器，直到 app ready
        if (app.isReady()) {
            this.setupPermissionHandler()
        } else {
            app.whenReady().then(() => {
                this.setupPermissionHandler()
            })
        }
    }

    static getInstance(): PermissionManager {
        if (!PermissionManager.instance) {
            PermissionManager.instance = new PermissionManager()
        }
        return PermissionManager.instance
    }

    /**
     * 设置 Electron 权限请求处理器
     * 用于 Windows/Linux 以及作为 macOS 的后备
     */
    private setupPermissionHandler(): void {
        if (this.sessionHandlerSetup) {
            return
        }
        this.sessionHandlerSetup = true
        log.info('[PermissionManager] Setting up Electron permission handlers')

        // 权限请求处理器
        session.defaultSession.setPermissionRequestHandler(
            (_webContents, permission, callback, details) => {
                log.info(`[PermissionManager] Permission request: ${permission}`, details)

                // 映射 Electron 权限到我们的类型
                const permType = this.mapElectronPermission(permission)

                if (permType) {
                    // 对于 macOS，检查系统权限状态
                    if (process.platform === 'darwin') {
                        const status = this.getStatus(permType)
                        log.info(`[PermissionManager] macOS status for ${permType}: ${status}`)
                        if (permType === 'geolocation') {
                            // geolocation 在 not-determined 时必须允许请求，才能触发系统授权弹窗
                            callback(status !== 'denied' && status !== 'restricted')
                            return
                        }
                        callback(status === 'granted')
                    } else {
                        // Windows/Linux: 默认允许（可以在这里添加自定义 UI）
                        log.info(`[PermissionManager] Allowing ${permission} on ${process.platform}`)
                        callback(true)
                    }
                } else {
                    // 未知权限类型，拒绝
                    log.warn(`[PermissionManager] Unknown permission type: ${permission}`)
                    callback(false)
                }
            }
        )

        // 权限检查处理器
        session.defaultSession.setPermissionCheckHandler(
            (_webContents, permission, requestingOrigin, details) => {
                // `background-sync` 会被页面周期性轮询，保留日志会造成主日志噪声
                if ((permission as string) === 'background-sync') {
                    return false
                }

                log.debug(`[PermissionManager] Permission check: ${permission}`, { requestingOrigin, details })

                const permType = this.mapElectronPermission(permission)
                if (permType) {
                    const status = this.getStatus(permType)
                    if (permType === 'geolocation') {
                        // geolocation 允许 unknown/not-determined 继续请求，避免首次请求被拦截
                        return status !== 'denied' && status !== 'restricted'
                    }
                    return status === 'granted'
                }

                return false
            }
        )
    }

    /**
     * 将 Electron 权限名映射到我们的类型
     */
    private mapElectronPermission(permission: string): PermissionType | null {
        const mapping: Record<string, PermissionType> = {
            'geolocation': 'geolocation',
            'media': 'camera', // 需要进一步区分
            'camera': 'camera',
            'microphone': 'microphone',
            'notifications': 'notifications',
            'mediaKeySystem': 'screen',
            'accessibility-events': 'accessibility',
        }
        return mapping[permission] || null
    }

    /**
     * 获取权限状态
     */
    getStatus(type: PermissionType): PermissionStatus {
        log.info(`[PermissionManager] Getting status for: ${type}`)

        if (type === 'geolocation' && this.geolocationStatusOverride) {
            return this.geolocationStatusOverride
        }

        if (process.platform === 'darwin' && permissions) {
            const macType = mapToMacPermissionType(type)
            if (macType) {
                try {
                    const status = permissions.getAuthStatus(macType)
                    log.info(`[PermissionManager] macOS ${type} status: ${status}`)
                    const normalized = normalizeStatus(status)

                    if (type === 'geolocation') {
                        if (normalized === 'granted' || normalized === 'restricted') {
                            return normalized
                        }
                        if (normalized === 'denied') {
                            // node-mac-permissions v2.5.0 在 location 未请求时也可能返回 denied
                            return 'not-determined'
                        }
                    }

                    return normalized
                } catch (error) {
                    log.error(`[PermissionManager] Error getting status for ${type}:`, error)
                    return 'unknown'
                }
            }
        }

        // Windows/Linux: 检查缓存状态，或默认为已授权
        if (process.platform === 'darwin') {
            // macOS 但无法使用 node-mac-permissions
            // 尝试使用 systemPreferences（对于媒体类型）
            if (type === 'camera' || type === 'microphone') {
                const status = systemPreferences.getMediaAccessStatus(type)
                log.info(`[PermissionManager] systemPreferences ${type} status: ${status}`)
                return normalizeStatus(status)
            }
            return 'unknown'
        }

        // Windows/Linux 默认返回 granted
        log.info(`[PermissionManager] ${process.platform} defaulting to granted for ${type}`)
        return 'granted'
    }

    /**
     * 请求权限
     */
    async request(type: PermissionType): Promise<PermissionStatus> {
        log.info(`[PermissionManager] Requesting permission: ${type}`)

        if (process.platform === 'darwin') {
            return this.requestMacOS(type)
        } else {
            // Windows/Linux: 通过触发实际功能来请求权限
            return this.requestWindowsLinux(type)
        }
    }

    /**
     * macOS 权限请求
     */
    private async requestMacOS(type: PermissionType): Promise<PermissionStatus> {
        log.info(`[PermissionManager] macOS requesting: ${type}`)

        // 对于相机和麦克风，使用 systemPreferences
        if (type === 'camera' || type === 'microphone') {
            try {
                const granted = await systemPreferences.askForMediaAccess(type)
                log.info(`[PermissionManager] askForMediaAccess(${type}) result: ${granted}`)
                return granted ? 'granted' : 'denied'
            } catch (error) {
                log.error(`[PermissionManager] askForMediaAccess error:`, error)
                return 'denied'
            }
        }

        // 对于位置等其他权限，使用 node-mac-permissions
        if (permissions) {
            const macType = mapToMacPermissionType(type)
            if (macType) {
                try {
                    // askForXXXAccess 方法
                    const askMethod = `askFor${macType.charAt(0).toUpperCase() + macType.slice(1)}Access`
                    const askFn = permissions[askMethod]
                    if (typeof askFn === 'function') {
                        const result = await askFn()
                        log.info(`[PermissionManager] ${askMethod} result:`, result)
                        return normalizeStatus(result)
                    } else {
                        log.warn(`[PermissionManager] No ask method for ${macType}`)
                    }
                } catch (error) {
                    log.error(`[PermissionManager] Error requesting ${type}:`, error)
                }
            }
        }

        // 后备：提示用户手动开启
        log.warn(`[PermissionManager] Cannot programmatically request ${type}, user needs to enable manually`)
        return this.getStatus(type)
    }

    /**
     * Windows/Linux 权限请求
     */
    private async requestWindowsLinux(type: PermissionType): Promise<PermissionStatus> {
        log.info(`[PermissionManager] Windows/Linux requesting: ${type}`)

        // 大多数权限在 Windows/Linux 上是自动授权的
        // 返回当前状态
        return this.getStatus(type)
    }

    /**
     * 检查是否可以请求权限
     * 如果权限已被永久拒绝，需要用户手动到系统设置开启
     */
    canRequest(type: PermissionType): boolean {
        const status = this.getStatus(type)
        if (type === 'geolocation') {
            return status !== 'denied' && status !== 'restricted'
        }
        // 只有 not-determined 状态可以程序化请求
        return status === 'not-determined'
    }

    /**
     * 打开系统设置
     * 当权限被拒绝时，引导用户手动开启
     */
    openSystemSettings(type: PermissionType): boolean {
        log.info(`[PermissionManager] Opening system settings for: ${type}`)

        if (process.platform === 'darwin') {
            const { shell } = require('electron')
            // macOS 系统偏好设置 URL scheme
            const urlMap: Record<PermissionType, string> = {
                'geolocation': 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
                'camera': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
                'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
                'notifications': 'x-apple.systempreferences:com.apple.preference.notification',
                'screen': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
                'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
                'contacts': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts',
                'calendar': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
            }
            const url = urlMap[type]
            if (url) {
                shell.openExternal(url)
                return true
            }
            return false
        } else if (process.platform === 'win32') {
            // Windows 设置
            const { shell } = require('electron')
            shell.openExternal('ms-settings:privacy-location')
            return true
        }
        // Linux: 各发行版设置差异较大，暂不处理
        return false
    }

    /**
     * macOS 辅助功能权限是否已授权
     */
    isAccessibilityTrusted(): boolean {
        if (process.platform !== 'darwin') return true
        return systemPreferences.isTrustedAccessibilityClient(false)
    }

    /**
     * 供 geolocation 模块回写更可信的定位权限状态
     */
    setGeolocationStatus(status: PermissionStatus | null): void {
        this.geolocationStatusOverride = status
    }
}

export const permissionManager = PermissionManager.getInstance()
