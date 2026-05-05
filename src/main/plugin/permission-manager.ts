import { systemPreferences, session, app, dialog, BrowserWindow } from 'electron'
import log from 'electron-log'
import { resolveIpcCallerSource } from '../services/ipc-caller-resolver'
import {
    createMissingPluginPermissionError,
    createSystemPermissionDeniedError,
    getMissingPluginPermissions,
    isMediaPermissionType,
    isPluginManifestPermissionType,
    resolveRequiredMediaPermissions,
    type MediaPermissionManifest,
    type MediaPermissionDetails,
    type MediaPermissionType,
    type MediaPermissionResolutionOptions,
    type PluginManifestPermissionType
} from './media-permission-policy'

type MacPermissionsModule = {
    getAuthStatus: (type: string) => string
    askForScreenCaptureAccess?: (openPreferences?: boolean) => unknown | Promise<unknown>
    [key: string]: unknown
}

interface PermissionPluginLookupResult {
    manifest: {
        permissions?: MediaPermissionManifest
    }
}

type PendingDesktopCapture = {
    expiresAt: number
    audio: boolean
    webContentsId: number
    pluginId?: string
    windowId?: number
}

let permissionPluginLookup: ((pluginId: string) => PermissionPluginLookupResult | undefined) | null = null

export function setPermissionPluginLookup(
    lookup: (pluginId: string) => PermissionPluginLookupResult | undefined
): void {
    permissionPluginLookup = lookup
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
    | 'clipboard'
    | 'notification'
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
        'clipboard': null,
        'notification': null,
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
    private pendingDesktopCapturesByWebContents = new Map<number, PendingDesktopCapture>()
    private pendingDesktopCapturesByPlugin = new Map<string, PendingDesktopCapture>()
    private pendingDesktopCapturesByWindow = new Map<number, PendingDesktopCapture>()
    private macOSScreenRecordingNoticeShown = false

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

                const mediaPermissions = this.resolveMediaRequestPermissions(webContents, permission, details as unknown as MediaPermissionDetails, true)
                if (mediaPermissions) {
                    this.requestResolvedPermissions(webContents, mediaPermissions, details)
                        .then((granted) => callback(granted))
                        .catch(() => callback(false))
                    return
                }

                const permType = this.mapElectronPermission(permission)
                if (!permType) {
                    log.warn(`[PermissionManager] Unknown permission type: ${permission}`)
                    callback(false)
                    return
                }

                this.requestResolvedPermissions(webContents, [permType], details)
                    .then((granted) => callback(granted))
                    .catch(() => callback(false))
            }
        )

        // 权限检查处理器
        session.defaultSession.setPermissionCheckHandler(
            (webContents, permission, requestingOrigin, details) => {
                if ((permission as string) === 'background-sync') {
                    return false
                }

                log.debug(`[PermissionManager] Permission check: ${permission}`, { requestingOrigin, details })

                const mediaPermissions = this.resolveMediaRequestPermissions(webContents, permission, details as unknown as MediaPermissionDetails, false)
                if (mediaPermissions) {
                    return this.checkResolvedPermissions(webContents, mediaPermissions)
                }

                const permType = this.mapElectronPermission(permission)
                if (!permType) return false
                return this.checkResolvedPermissions(webContents, [permType])
            }
        )
    }

    /**
     * 将 Electron 权限名映射到我们的类型
     */
    private mapElectronPermission(permission: string): PermissionType | null {
        const mapping: Record<string, PermissionType> = {
            'geolocation': 'geolocation',
            'camera': 'camera',
            'microphone': 'microphone',
            'notifications': 'notification',
            'clipboard-read': 'clipboard',
            'clipboard-sanitized-write': 'clipboard',
            'mediaKeySystem': 'screen',
            'accessibility-events': 'accessibility',
        }
        return mapping[permission] || null
    }

    markPendingDesktopCapture(webContents: Electron.WebContents, options?: { audio?: boolean }): void {
        const ttlMs = 10_000
        const caller = resolveIpcCallerSource(webContents)
        const pending: PendingDesktopCapture = {
            expiresAt: Date.now() + ttlMs,
            audio: options?.audio === true,
            webContentsId: webContents.id,
            pluginId: caller.pluginId,
            windowId: caller.windowId
        }

        this.pendingDesktopCapturesByWebContents.set(webContents.id, pending)
        if (caller.pluginId) {
            this.pendingDesktopCapturesByPlugin.set(caller.pluginId, pending)
        }
        if (caller.windowId !== undefined) {
            this.pendingDesktopCapturesByWindow.set(caller.windowId, pending)
        }
    }

    private resolveMediaRequestPermissions(
        webContents: Electron.WebContents | null,
        permission: string,
        details: MediaPermissionDetails | undefined,
        consumePendingDesktopCapture: boolean
    ): MediaPermissionType[] | null {
        const pendingDesktopCapture = this.getPendingDesktopCapture(webContents, details)
        const resolutionOptions: MediaPermissionResolutionOptions = pendingDesktopCapture
            ? { desktopCapture: true, desktopAudio: pendingDesktopCapture.audio }
            : {}
        const mediaPermissions = resolveRequiredMediaPermissions(permission, details, resolutionOptions)
        if (!mediaPermissions) return null

        if (consumePendingDesktopCapture && pendingDesktopCapture) {
            this.clearPendingDesktopCapture(pendingDesktopCapture)
        }

        if (mediaPermissions.length > 0) return mediaPermissions

        if (!webContents) {
            log.warn('[PermissionManager] Rejected media permission with unknown audio/video type from unknown webContents')
            return []
        }

        const caller = resolveIpcCallerSource(webContents)
        if (caller.source === 'app') {
            return ['camera']
        }

        this.logUnresolvedMediaPermission(webContents, details, caller)
        if (caller.source === 'plugin' && caller.pluginId) {
            log.warn(`[PermissionManager] Plugin "${caller.pluginId}" requested media permission without a concrete audio/video type`)
        } else {
            log.warn(`[PermissionManager] Rejected media permission with unknown audio/video type from ${caller.source}`)
        }
        return []
    }

    private getPendingDesktopCapture(
        webContents: Electron.WebContents | null,
        details: MediaPermissionDetails | undefined
    ): PendingDesktopCapture | null {
        if (!webContents) return null

        if (!this.shouldApplyPendingDesktopCapture(details)) {
            return null
        }

        const caller = resolveIpcCallerSource(webContents)
        const candidates = [
            this.pendingDesktopCapturesByWebContents.get(webContents.id),
            caller.pluginId ? this.pendingDesktopCapturesByPlugin.get(caller.pluginId) : undefined,
            caller.windowId !== undefined ? this.pendingDesktopCapturesByWindow.get(caller.windowId) : undefined
        ]

        for (const context of candidates) {
            if (!context) continue

            if (context.expiresAt <= Date.now()) {
                this.clearPendingDesktopCapture(context)
                continue
            }

            return context
        }

        return null
    }

    private clearPendingDesktopCapture(context: PendingDesktopCapture | undefined): void {
        if (!context) return

        if (this.pendingDesktopCapturesByWebContents.get(context.webContentsId) === context) {
            this.pendingDesktopCapturesByWebContents.delete(context.webContentsId)
        }
        if (context.pluginId && this.pendingDesktopCapturesByPlugin.get(context.pluginId) === context) {
            this.pendingDesktopCapturesByPlugin.delete(context.pluginId)
        }
        if (context.windowId !== undefined && this.pendingDesktopCapturesByWindow.get(context.windowId) === context) {
            this.pendingDesktopCapturesByWindow.delete(context.windowId)
        }
    }

    private shouldApplyPendingDesktopCapture(details: MediaPermissionDetails | undefined): boolean {
        if (!details) return true
        if (Array.isArray(details.mediaTypes)) {
            if (details.mediaTypes.length === 0) return true
            return details.mediaTypes.includes('video')
        }
        return details.mediaType === undefined || details.mediaType === 'unknown' || details.mediaType === 'video'
    }

    private logUnresolvedMediaPermission(
        webContents: Electron.WebContents,
        details: MediaPermissionDetails | undefined,
        caller: ReturnType<typeof resolveIpcCallerSource>
    ): void {
        log.warn('[PermissionManager] Unresolved media permission details', {
            mediaTypes: details?.mediaTypes,
            mediaType: details?.mediaType,
            webContentsId: webContents.id,
            pluginId: caller.pluginId,
            windowId: caller.windowId,
            pendingByWebContents: this.pendingDesktopCapturesByWebContents.has(webContents.id),
            pendingByPlugin: caller.pluginId ? this.pendingDesktopCapturesByPlugin.has(caller.pluginId) : false,
            pendingByWindow: caller.windowId !== undefined ? this.pendingDesktopCapturesByWindow.has(caller.windowId) : false,
        })
    }

    private async requestResolvedPermissions(
        webContents: Electron.WebContents,
        types: PermissionType[],
        details: Electron.PermissionRequest | Electron.FilesystemPermissionRequest | Electron.MediaAccessPermissionRequest | Electron.OpenExternalPermissionRequest
    ): Promise<boolean> {
        if (types.length === 0) return false
        if (!this.canCallerAccessPluginPermissions(webContents, types.filter(isPluginManifestPermissionType))) {
            return false
        }

        for (const type of types) {
            const granted = await this.requestSinglePermission(webContents, type, details)
            if (!granted) {
                if (isMediaPermissionType(type)) {
                    log.warn(`[PermissionManager] ${createSystemPermissionDeniedError(type).message}`)
                }
                return false
            }
        }

        return true
    }

    private async requestSinglePermission(
        webContents: Electron.WebContents,
        type: PermissionType,
        details: Electron.PermissionRequest | Electron.FilesystemPermissionRequest | Electron.MediaAccessPermissionRequest | Electron.OpenExternalPermissionRequest
    ): Promise<boolean> {
        if (process.platform === 'darwin') {
            return this.requestSingleMacOSPermission(type)
        }

        // Use webContents.id as the primary cache scope so that
        // file:// pages (whose URL origin is "null") don't share
        // a single grant across all local windows.
        const wcId = webContents?.id ?? 0
        const cacheKey = `wc:${wcId}:${type}`

        const cached = this.nonMacDecisions.get(cacheKey)
        if (cached !== undefined) {
            return cached
        }

        const displayOrigin = this.getDisplayOrigin(details)
        const granted = await this.showPermissionDialog(type, displayOrigin)
        this.nonMacDecisions.set(cacheKey, granted)
        return granted
    }

    private async requestSingleMacOSPermission(type: PermissionType): Promise<boolean> {
        if (type === 'screen') {
            // Screen capture TCC status can be a false negative for dev builds,
            // re-signed Electron binaries, or sessions that have not restarted
            // after authorization. Once manifest policy passes, let the actual
            // capture/getUserMedia call determine whether the system allows it.
            return true
        }

        const status = this.getStatus(type)
        log.debug(`[PermissionManager] macOS status for ${type}: ${status}`)

        if (type === 'geolocation') {
            return status !== 'denied' && status !== 'restricted'
        }

        return status === 'granted'
    }

    private checkResolvedPermissions(webContents: Electron.WebContents | null, types: PermissionType[]): boolean {
        if (types.length === 0) return false
        const manifestPermissions = types.filter(isPluginManifestPermissionType)
        if (manifestPermissions.length > 0 && !webContents) {
            return false
        }
        if (webContents && !this.canCallerAccessPluginPermissions(webContents, manifestPermissions)) {
            return false
        }

        return types.every((type) => this.checkSinglePermission(webContents, type))
    }

    private checkSinglePermission(webContents: Electron.WebContents | null, type: PermissionType): boolean {
        if (process.platform === 'darwin') {
            if (type === 'screen') {
                return true
            }
            const status = this.getStatus(type)
            if (type === 'geolocation') {
                return status !== 'denied' && status !== 'restricted'
            }
            return status === 'granted'
        }

        // Windows/Linux: check per-webContents cache
        const wcId = webContents?.id ?? 0
        const cacheKey = `wc:${wcId}:${type}`
        const cached = this.nonMacDecisions.get(cacheKey)
        if (type === 'geolocation') {
            return cached !== false
        }
        return cached === true
    }

    private getDisplayOrigin(
        details: Electron.PermissionRequest | Electron.FilesystemPermissionRequest | Electron.MediaAccessPermissionRequest | Electron.OpenExternalPermissionRequest
    ): string {
        const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : undefined
        if (!requestingUrl) return 'unknown'
        try {
            return new URL(requestingUrl).origin
        } catch {
            return requestingUrl
        }
    }

    /**
     * 获取权限状态
     */
    getStatus(type: PermissionType): PermissionStatus {
        log.debug(`[PermissionManager] Getting status for: ${type}`)

        if (type === 'geolocation' && this.geolocationStatusOverride) {
            return this.geolocationStatusOverride
        }

        if (type === 'clipboard' || type === 'notification') {
            return 'granted'
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

        if (type === 'screen') {
            if (permissions) {
                const askFn = permissions.askForScreenCaptureAccess
                if (typeof askFn === 'function') {
                    try {
                        await askFn(true)
                        await this.showMacOSScreenRecordingRestartNotice()
                        const status = this.getStatus('screen')
                        return status
                    } catch (error) {
                        log.error('[PermissionManager] askForScreenCaptureAccess error:', error)
                    }
                } else {
                    log.warn('[PermissionManager] No askForScreenCaptureAccess method for screen')
                }
            }

            this.openSystemSettings('screen')
            await this.showMacOSScreenRecordingRestartNotice()
            const status = this.getStatus('screen')
            return status
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

    private async showMacOSScreenRecordingRestartNotice(): Promise<void> {
        if (this.macOSScreenRecordingNoticeShown) return
        this.macOSScreenRecordingNoticeShown = true

        const opts: Electron.MessageBoxOptions = {
            type: 'info',
            buttons: ['知道了'],
            defaultId: 0,
            cancelId: 0,
            title: '需要屏幕录制权限',
            message: '请在 macOS 系统设置中允许 Mulby 进行屏幕录制',
            detail: '授权后需要完全退出并重新打开 Mulby，屏幕录制权限才会生效。',
        }

        const parentWindow = BrowserWindow.getFocusedWindow()
        if (parentWindow) {
            await dialog.showMessageBox(parentWindow, opts)
            return
        }
        await dialog.showMessageBox(opts)
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
            clipboard: '剪贴板',
            notification: '通知',
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

    canCallerAccessMediaPermission(sender: Electron.WebContents, type: MediaPermissionType): boolean {
        return this.canCallerAccessMediaPermissions(sender, [type])
    }

    canCallerAccessMediaPermissions(sender: Electron.WebContents, required: readonly MediaPermissionType[]): boolean {
        return this.canCallerAccessPluginPermissions(sender, required)
    }

    canCallerAccessPluginPermissions(sender: Electron.WebContents, required: readonly PluginManifestPermissionType[]): boolean {
        if (required.length === 0) return true

        const caller = resolveIpcCallerSource(sender)
        if (caller.source === 'app') return true

        if (caller.source !== 'plugin' || !caller.pluginId) {
            log.warn(`[PermissionManager] Rejected media permission ${required.join(', ')} from ${caller.source}`)
            return false
        }

        const plugin = permissionPluginLookup?.(caller.pluginId)
        const missing = getMissingPluginPermissions(plugin?.manifest.permissions, required)
        if (missing.length > 0) {
            log.warn(`[PermissionManager] Plugin "${caller.pluginId}" lacks ${missing.map((type) => `manifest.permissions.${type}`).join(', ')}`)
            return false
        }

        return true
    }

    ensureCallerAccessMediaPermissions(sender: Electron.WebContents, required: readonly MediaPermissionType[]): void {
        this.ensureCallerAccessPluginPermissions(sender, required)
    }

    ensureCallerAccessPluginPermissions(sender: Electron.WebContents, required: readonly PluginManifestPermissionType[]): void {
        if (required.length === 0) return

        const caller = resolveIpcCallerSource(sender)
        if (caller.source === 'app') return

        if (caller.source !== 'plugin' || !caller.pluginId) {
            throw new Error(`Rejected media permission ${required.join(', ')} from ${caller.source}`)
        }

        const plugin = permissionPluginLookup?.(caller.pluginId)
        const missing = getMissingPluginPermissions(plugin?.manifest.permissions, required)
        if (missing.length > 0) {
            const message = `Plugin "${caller.pluginId}" lacks ${missing.map((type) => `manifest.permissions.${type}`).join(', ')}`
            log.warn(`[PermissionManager] ${message}`)
            throw createMissingPluginPermissionError(caller.pluginId, missing[0])
        }
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
                'clipboard': '',
                'notification': '',
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
                'clipboard': 'ms-settings:clipboard',
                'notification': 'ms-settings:notifications',
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
