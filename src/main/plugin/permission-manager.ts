import { systemPreferences, session, app, dialog, BrowserWindow } from 'electron'
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
        log.debug('[PermissionManager] Loaded node-mac-permissions')
    } catch (error) {
        log.warn('[PermissionManager] Failed to load node-mac-permissions:', error)
    }
}

export type PermissionType =
    | 'geolocation'
    | 'camera'
    | 'microphone'
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
    private nonMacDecisions = new Map<string, boolean>()

    private constructor() {
        log.debug('[PermissionManager] Initializing...')
        log.debug(`[PermissionManager] Platform: ${process.platform}`)
        log.debug(`[PermissionManager] node-mac-permissions loaded: ${permissions !== null}`)

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
        log.debug('[PermissionManager] Setting up Electron permission handlers')

        // 权限请求处理器
        session.defaultSession.setPermissionRequestHandler(
            (webContents, permission, callback, details) => {
                log.debug(`[PermissionManager] Permission request: ${permission}`, details)

                const permType = this.mapElectronPermission(permission)

                if (permType) {
                    if (process.platform === 'darwin') {
                        const status = this.getStatus(permType)
                        log.debug(`[PermissionManager] macOS status for ${permType}: ${status}`)
                        if (permType === 'geolocation') {
                            callback(status !== 'denied' && status !== 'restricted')
                            return
                        }
                        callback(status === 'granted')
                    } else {
                        // Use webContents.id as the primary cache scope so that
                        // file:// pages (whose URL origin is "null") don't share
                        // a single grant across all local windows.
                        const wcId = webContents?.id ?? 0
                        const cacheKey = `wc:${wcId}:${permType}`

                        const cached = this.nonMacDecisions.get(cacheKey)
                        if (cached !== undefined) {
                            callback(cached)
                            return
                        }

                        const displayOrigin = details.requestingUrl
                            ? new URL(details.requestingUrl).origin
                            : 'unknown'

                        this.showPermissionDialog(permType, displayOrigin)
                            .then(granted => {
                                this.nonMacDecisions.set(cacheKey, granted)
                                callback(granted)
                            })
                            .catch(() => callback(false))
                    }
                } else {
                    log.warn(`[PermissionManager] Unknown permission type: ${permission}`)
                    callback(false)
                }
            }
        )

        // 权限检查处理器
        session.defaultSession.setPermissionCheckHandler(
            (webContents, permission, requestingOrigin, details) => {
                if ((permission as string) === 'background-sync') {
                    return false
                }

                log.debug(`[PermissionManager] Permission check: ${permission}`, { requestingOrigin, details })

                const permType = this.mapElectronPermission(permission)
                if (permType) {
                    if (process.platform === 'darwin') {
                        const status = this.getStatus(permType)
                        if (permType === 'geolocation') {
                            return status !== 'denied' && status !== 'restricted'
                        }
                        return status === 'granted'
                    }
                    // Windows/Linux: check per-webContents cache
                    const wcId = webContents?.id ?? 0
                    const cacheKey = `wc:${wcId}:${permType}`
                    const cached = this.nonMacDecisions.get(cacheKey)
                    if (permType === 'geolocation') {
                        return cached !== false
                    }
                    return cached === true
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
            'mediaKeySystem': 'screen',
            'accessibility-events': 'accessibility',
        }
        return mapping[permission] || null
    }

    /**
     * 获取权限状态
     */
    getStatus(type: PermissionType): PermissionStatus {
        log.debug(`[PermissionManager] Getting status for: ${type}`)

        if (type === 'geolocation' && this.geolocationStatusOverride) {
            return this.geolocationStatusOverride
        }

        if (process.platform === 'darwin' && permissions) {
            const macType = mapToMacPermissionType(type)
            if (macType) {
                try {
                    const status = permissions.getAuthStatus(macType)
                    log.debug(`[PermissionManager] macOS ${type} status: ${status}`)
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
                log.debug(`[PermissionManager] systemPreferences ${type} status: ${status}`)
                return normalizeStatus(status)
            }
            return 'unknown'
        }

        // Windows/Linux: getStatus() without webContents context
        // cannot determine per-window grants, so return 'not-determined'
        // to let the permission request handler prompt the user.
        return 'not-determined'
    }

    /**
     * 请求权限
     */
    async request(type: PermissionType): Promise<PermissionStatus> {
        log.debug(`[PermissionManager] Requesting permission: ${type}`)

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
        log.debug(`[PermissionManager] macOS requesting: ${type}`)

        // 对于相机和麦克风，使用 systemPreferences
        if (type === 'camera' || type === 'microphone') {
            try {
                const granted = await systemPreferences.askForMediaAccess(type)
                log.debug(`[PermissionManager] askForMediaAccess(${type}) result: ${granted}`)
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
                        log.debug(`[PermissionManager] ${askMethod} result:`, result)
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
        log.debug(`[PermissionManager] Windows/Linux requesting: ${type}`)

        // 大多数权限在 Windows/Linux 上是自动授权的
        // 返回当前状态
        return this.getStatus(type)
    }

    private async showPermissionDialog(
        type: PermissionType,
        origin: string,
    ): Promise<boolean> {
        const labels: Record<PermissionType, string> = {
            geolocation: '位置信息',
            camera: '摄像头',
            microphone: '麦克风',
            screen: '屏幕录制',
            accessibility: '辅助功能',
            contacts: '通讯录',
            calendar: '日历',
        }
        const label = labels[type] || type

        const parentWindow = BrowserWindow.getFocusedWindow()
        const opts: Electron.MessageBoxOptions = {
            type: 'question',
            buttons: ['允许', '拒绝'],
            defaultId: 1,
            cancelId: 1,
            title: '权限请求',
            message: `"${origin}" 请求访问${label}`,
            detail: '你可以选择允许或拒绝此请求。本次选择在应用重启前持续有效。',
        }

        const result = parentWindow
            ? await dialog.showMessageBox(parentWindow, opts)
            : await dialog.showMessageBox(opts)

        const granted = result.response === 0
        log.debug(`[PermissionManager] User ${granted ? 'allowed' : 'denied'} ${type} for ${origin}`)
        return granted
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
        log.debug(`[PermissionManager] Opening system settings for: ${type}`)

        if (process.platform === 'darwin') {
            const { shell } = require('electron')
            // macOS 系统偏好设置 URL scheme
            const urlMap: Record<PermissionType, string> = {
                'geolocation': 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
                'camera': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
                'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
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
            // Windows 设置页面映射
            const { shell } = require('electron')
            const winUrlMap: Partial<Record<PermissionType, string>> = {
                'geolocation': 'ms-settings:privacy-location',
                'camera': 'ms-settings:privacy-webcam',
                'microphone': 'ms-settings:privacy-microphone',
            }
            const url = winUrlMap[type] || 'ms-settings:privacy'
            shell.openExternal(url)
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
