import { useMemo } from 'react'

/**
 * InTools API Hook - 统一访问各 API
 */
export function useIntools(pluginId?: string) {
    return useMemo(() => ({
        // Clipboard API
        clipboard: {
            readText: () => window.intools?.clipboard?.readText(),
            writeText: (text: string) => window.intools?.clipboard?.writeText(text),
            readImage: () => window.intools?.clipboard?.readImage(),
            writeImage: (image: string | ArrayBuffer) => window.intools?.clipboard?.writeImage(image),
            readFiles: () => window.intools?.clipboard?.readFiles(),
            writeFiles: (files: string | string[]) => window.intools?.clipboard?.writeFiles(files),
            getFormat: () => window.intools?.clipboard?.getFormat(),
        },

        // Input API
        input: {
            hideMainWindowPasteText: (text: string) => window.intools?.input?.hideMainWindowPasteText(text),
            hideMainWindowPasteImage: (image: string | ArrayBuffer) => window.intools?.input?.hideMainWindowPasteImage(image),
            hideMainWindowPasteFile: (filePaths: string | string[]) => window.intools?.input?.hideMainWindowPasteFile(filePaths),
            hideMainWindowTypeString: (text: string) => window.intools?.input?.hideMainWindowTypeString(text),
            // 模拟按键 API
            simulateKeyboardTap: (key: string, ...modifiers: string[]) =>
                window.intools?.input?.simulateKeyboardTap(key, ...modifiers),
            simulateMouseMove: (x: number, y: number) =>
                window.intools?.input?.simulateMouseMove(x, y),
            simulateMouseClick: (x: number, y: number) =>
                window.intools?.input?.simulateMouseClick(x, y),
            simulateMouseDoubleClick: (x: number, y: number) =>
                window.intools?.input?.simulateMouseDoubleClick(x, y),
            simulateMouseRightClick: (x: number, y: number) =>
                window.intools?.input?.simulateMouseRightClick(x, y),
        },

        // Storage API
        storage: {
            get: (key: string) => window.intools?.storage?.get(key, pluginId),
            set: (key: string, value: unknown) => window.intools?.storage?.set(key, value, pluginId),
            remove: (key: string) => window.intools?.storage?.remove(key, pluginId),
        },

        // Window API
        window: {
            setSize: (width: number, height: number) => window.intools?.window?.setSize(width, height),
            setExpendHeight: (height: number) => window.intools?.window?.setExpendHeight?.(height),
            hide: (isRestorePreWindow?: boolean) => window.intools?.window?.hide?.(isRestorePreWindow),
            show: () => window.intools?.window?.show(),
            close: () => window.intools?.window?.close(),
            create: (url: string, options?: { width?: number; height?: number; title?: string }) =>
                window.intools?.window?.create(url, options),
            detach: () => window.intools?.window?.detach?.(),
            setAlwaysOnTop: (flag: boolean) => window.intools?.window?.setAlwaysOnTop?.(flag),
            getMode: () => window.intools?.window?.getMode?.(),
            getWindowType: () => window.intools?.window?.getWindowType?.(),
            minimize: () => window.intools?.window?.minimize?.(),
            maximize: () => window.intools?.window?.maximize?.(),
            getState: () => window.intools?.window?.getState?.(),
            reload: () => window.intools?.window?.reload?.(),
            sendToParent: (channel: string, ...args: unknown[]) =>
                window.intools?.window?.sendToParent?.(channel, ...args),
            onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) =>
                window.intools?.window?.onChildMessage?.(callback),
            findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
                window.intools?.window?.findInPage?.(text, options),
            stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
                window.intools?.window?.stopFindInPage?.(action),
            startDrag: (filePath: string | string[]) => window.intools?.window?.startDrag?.(filePath),
        },

        // SubInput API
        subInput: {
            set: (placeholder?: string, isFocus?: boolean) => window.intools?.subInput?.set?.(placeholder, isFocus),
            remove: () => window.intools?.subInput?.remove?.(),
            setValue: (text: string) => window.intools?.subInput?.setValue?.(text),
            focus: () => window.intools?.subInput?.focus?.(),
            blur: () => window.intools?.subInput?.blur?.(),
            select: () => window.intools?.subInput?.select?.(),
            onChange: (callback: (data: { text: string }) => void) => window.intools?.subInput?.onChange?.(callback),
        },

        // Plugin API
        plugin: {
            redirect: (label: string | [string, string], payload?: unknown) =>
                window.intools?.plugin?.redirect?.(label, payload),
            outPlugin: (isKill?: boolean) => window.intools?.plugin?.outPlugin?.(isKill),
        },

        // HTTP API
        http: {
            request: (options: {
                url: string
                method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
                headers?: Record<string, string>
                body?: unknown
                timeout?: number
            }) => window.intools?.http?.request(options),
            get: (url: string, headers?: Record<string, string>) => window.intools?.http?.get(url, headers),
            post: (url: string, body?: unknown, headers?: Record<string, string>) =>
                window.intools?.http?.post(url, body, headers),
            put: (url: string, body?: unknown, headers?: Record<string, string>) =>
                window.intools?.http?.put(url, body, headers),
            delete: (url: string, headers?: Record<string, string>) => window.intools?.http?.delete(url, headers),
        },

        // Filesystem API
        filesystem: {
            readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.readFile(path, encoding),
            writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
                window.intools?.filesystem?.writeFile(path, data, encoding),
            exists: (path: string) => window.intools?.filesystem?.exists(path),
            readdir: (path: string) => window.intools?.filesystem?.readdir(path),
            mkdir: (path: string) => window.intools?.filesystem?.mkdir(path),
            stat: (path: string) => window.intools?.filesystem?.stat(path),
            copy: (src: string, dest: string) => window.intools?.filesystem?.copy(src, dest),
            move: (src: string, dest: string) => window.intools?.filesystem?.move(src, dest),
            unlink: (path: string) => window.intools?.filesystem?.unlink(path),
        },

        // Screen API
        screen: {
            getAllDisplays: () => window.intools?.screen?.getAllDisplays(),
            getPrimaryDisplay: () => window.intools?.screen?.getPrimaryDisplay(),
            getCursorScreenPoint: () => window.intools?.screen?.getCursorScreenPoint(),
            getDisplayNearestPoint: (point: { x: number; y: number }) =>
                window.intools?.screen?.getDisplayNearestPoint?.(point),
            getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
                window.intools?.screen?.getDisplayMatching?.(rect),
            getSources: (options?: { types?: ('screen' | 'window')[], thumbnailSize?: { width: number, height: number } }) =>
                window.intools?.screen?.getSources(options),
            capture: (options?: { sourceId?: string, format?: 'png' | 'jpeg', quality?: number }) =>
                window.intools?.screen?.capture(options),
            captureRegion: (region: { x: number, y: number, width: number, height: number }, options?: { format?: 'png' | 'jpeg', quality?: number }) =>
                window.intools?.screen?.captureRegion(region, options),
            screenCapture: () => window.intools?.screen?.screenCapture(),
            colorPick: () => window.intools?.screen?.colorPick?.(),
        },

        // Shell API
        shell: {
            openPath: (path: string) => window.intools?.shell?.openPath(path),
            openExternal: (url: string) => window.intools?.shell?.openExternal(url),
            showItemInFolder: (path: string) => window.intools?.shell?.showItemInFolder(path),
            openFolder: (path: string) => window.intools?.shell?.openFolder(path),
            trashItem: (path: string) => window.intools?.shell?.trashItem(path),
            beep: () => window.intools?.shell?.beep(),
        },

        // Dialog API
        dialog: {
            showOpenDialog: (options?: {
                title?: string
                defaultPath?: string
                filters?: { name: string, extensions: string[] }[]
                properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
            }) => window.intools?.dialog?.showOpenDialog(options),
            showSaveDialog: (options?: {
                title?: string
                defaultPath?: string
                filters?: { name: string, extensions: string[] }[]
            }) => window.intools?.dialog?.showSaveDialog(options),
            showMessageBox: (options: {
                type?: 'none' | 'info' | 'error' | 'question' | 'warning'
                title?: string
                message: string
                detail?: string
                buttons?: string[]
            }) => window.intools?.dialog?.showMessageBox(options),
        },

        // System API
        system: {
            getSystemInfo: () => window.intools?.system?.getSystemInfo(),
            getAppInfo: () => window.intools?.system?.getAppInfo(),
            getPath: (name: string) => window.intools?.system?.getPath(name as any),
            getEnv: (name: string) => window.intools?.system?.getEnv(name),
            getIdleTime: () => window.intools?.system?.getIdleTime(),
            // 新增 API
            getFileIcon: (filePath: string) => window.intools?.system?.getFileIcon?.(filePath),
            getNativeId: () => window.intools?.system?.getNativeId?.(),
            isDev: () => window.intools?.system?.isDev?.(),
            isMacOS: () => window.intools?.system?.isMacOS?.(),
            isWindows: () => window.intools?.system?.isWindows?.(),
            isLinux: () => window.intools?.system?.isLinux?.(),
        },

        // Permission API
        permission: {
            getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
                window.intools?.permission?.getStatus(type),
            request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
                window.intools?.permission?.request(type),
            canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
                window.intools?.permission?.canRequest(type),
            openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
                window.intools?.permission?.openSystemSettings(type),
            isAccessibilityTrusted: () => window.intools?.permission?.isAccessibilityTrusted()
        },

        // Power API
        power: {
            getSystemIdleTime: () => window.intools?.power?.getSystemIdleTime(),
            getSystemIdleState: (threshold: number) => window.intools?.power?.getSystemIdleState(threshold),
            isOnBatteryPower: () => window.intools?.power?.isOnBatteryPower(),
            getCurrentThermalState: () => window.intools?.power?.getCurrentThermalState(),
        },

        // Network API
        network: {
            isOnline: () => window.intools?.network?.isOnline(),
        },

        // Geolocation API
        geolocation: {
            getAccessStatus: () => window.intools?.geolocation?.getAccessStatus(),
            requestAccess: () => window.intools?.geolocation?.requestAccess(),
            canGetPosition: () => window.intools?.geolocation?.canGetPosition(),
            openSettings: () => window.intools?.geolocation?.openSettings(),
            getCurrentPosition: () => window.intools?.geolocation?.getCurrentPosition(),
        },

        // TTS API
        tts: {
            speak: (text: string, options?: { lang?: string, rate?: number, pitch?: number, volume?: number }) =>
                window.intools?.tts?.speak(text, options),
            stop: () => window.intools?.tts?.stop(),
            pause: () => window.intools?.tts?.pause(),
            resume: () => window.intools?.tts?.resume(),
            getVoices: () => window.intools?.tts?.getVoices(),
            isSpeaking: () => window.intools?.tts?.isSpeaking(),
        },

        // Media API
        media: {
            getAccessStatus: (type: 'camera' | 'microphone') => window.intools?.media?.getAccessStatus(type),
            askForAccess: (type: 'camera' | 'microphone') => window.intools?.media?.askForAccess(type),
            hasCameraAccess: () => window.intools?.media?.hasCameraAccess(),
            hasMicrophoneAccess: () => window.intools?.media?.hasMicrophoneAccess(),
        },

        // Shortcut API
        shortcut: {
            register: (accelerator: string) => window.intools?.shortcut?.register(accelerator),
            unregister: (accelerator: string) => window.intools?.shortcut?.unregister(accelerator),
            unregisterAll: () => window.intools?.shortcut?.unregisterAll(),
            isRegistered: (accelerator: string) => window.intools?.shortcut?.isRegistered(accelerator),
        },

        // Security API
        security: {
            isEncryptionAvailable: () => window.intools?.security?.isEncryptionAvailable(),
            encryptString: (text: string) => window.intools?.security?.encryptString(text),
            decryptString: (data: ArrayBuffer) => window.intools?.security?.decryptString(data),
        },

        // Tray API
        tray: {
            create: (options: { icon: string, tooltip?: string, title?: string }) =>
                window.intools?.tray?.create(options),
            destroy: () => window.intools?.tray?.destroy(),
            setIcon: (icon: string) => window.intools?.tray?.setIcon(icon),
            setTooltip: (tooltip: string) => window.intools?.tray?.setTooltip(tooltip),
            setTitle: (title: string) => window.intools?.tray?.setTitle(title),
            exists: () => window.intools?.tray?.exists(),
        },

        // Menu API
        menu: {
            showContextMenu: (items: {
                label?: string
                type?: 'normal' | 'separator' | 'checkbox' | 'radio'
                checked?: boolean
                enabled?: boolean
                id?: string
                submenu?: unknown[]
            }[]) => window.intools?.menu?.showContextMenu(items as Parameters<typeof window.intools.menu.showContextMenu>[0]),
        },

        // Theme API
        theme: {
            get: () => window.intools?.theme?.get(),
            set: (mode: 'light' | 'dark' | 'system') => window.intools?.theme?.set(mode),
            getActual: () => window.intools?.theme?.getActual(),
        },
    }), [pluginId])
}
