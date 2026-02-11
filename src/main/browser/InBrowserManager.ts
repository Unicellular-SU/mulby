import { session, Session } from 'electron';
import { InBrowserWindow } from './InBrowserWindow';
import { InBrowserRunPayload, InBrowserOptions, InBrowserInstance } from '../../shared/types/inbrowser';

export class InBrowserManager {
    private static instance: InBrowserManager;
    private windows: Map<number, InBrowserWindow> = new Map();
    private windowOwners: Map<number, number> = new Map();
    private ownerToWindows: Map<number, Set<number>> = new Map();
    private proxyConfig: Electron.ProxyConfig | null = null;

    private constructor() { }

    public static getInstance(): InBrowserManager {
        if (!InBrowserManager.instance) {
            InBrowserManager.instance = new InBrowserManager();
        }
        return InBrowserManager.instance;
    }

    private createManagedPartition(): string {
        return `inbrowser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    private buildWindowOptions(options?: InBrowserOptions): { options: InBrowserOptions; cleanupSessionOnClose: boolean } {
        const defaultOptions: InBrowserOptions = {
            show: false,
            width: 800,
            height: 600
        };

        const merged: InBrowserOptions = {
            ...defaultOptions,
            ...(options || {})
        };

        const mergedWebPreferences: Electron.WebPreferences = {
            ...(options?.webPreferences || {})
        };

        let cleanupSessionOnClose = false;
        if (!mergedWebPreferences.partition) {
            mergedWebPreferences.partition = this.createManagedPartition();
            cleanupSessionOnClose = true;
        }

        merged.webPreferences = mergedWebPreferences;

        return { options: merged, cleanupSessionOnClose };
    }

    private trackOwnership(ownerId: number | undefined, windowId: number): void {
        if (ownerId === undefined) {
            return;
        }

        this.windowOwners.set(windowId, ownerId);
        let ids = this.ownerToWindows.get(ownerId);
        if (!ids) {
            ids = new Set<number>();
            this.ownerToWindows.set(ownerId, ids);
        }
        ids.add(windowId);
    }

    private releaseWindow(windowId: number): void {
        this.windows.delete(windowId);

        const ownerId = this.windowOwners.get(windowId);
        if (ownerId === undefined) {
            return;
        }

        this.windowOwners.delete(windowId);
        const ids = this.ownerToWindows.get(ownerId);
        if (!ids) {
            return;
        }

        ids.delete(windowId);
        if (ids.size === 0) {
            this.ownerToWindows.delete(ownerId);
        }
    }

    public async run(payload: InBrowserRunPayload, ownerId?: number): Promise<any[]> {
        let browserWindow: InBrowserWindow;

        // Check if ID is provided to reuse existing window

        if (payload.id && this.windows.has(payload.id)) {
            browserWindow = this.windows.get(payload.id)!;
            if (!this.windowOwners.has(payload.id)) {
                this.trackOwnership(ownerId, payload.id);
            }
        } else {
            const { options, cleanupSessionOnClose } = this.buildWindowOptions(payload.options);
            browserWindow = new InBrowserWindow(options, cleanupSessionOnClose);
            this.windows.set(browserWindow.id, browserWindow);
            this.trackOwnership(ownerId, browserWindow.id);

            // Handle window close to cleanup map
            browserWindow.window.on('closed', () => {
                this.releaseWindow(browserWindow.id);
            });

            // Apply proxy if set
            if (this.proxyConfig) {
                await browserWindow.window.webContents.session.setProxy(this.proxyConfig);
            }
        }

        // Execute Queue
        try {
            const result = await browserWindow.run(payload.queue);
            // If the window is still open and not meant to be persistent, we might handle it here?
            // uTools logic: if .show() was called, it stays open. If hidden, it might be reused or closed.
            // For now, let's return the result.

            // We append the window ID to the result as the last element, per uTools API behavior.
            // "run 返回将会返回一个包含数组的 Promise 对象，数组的最后一个元素是当前未关闭窗口的 InBrowser 实例"
            // But the InBrowserInstance object structure is { id, url, title, ... }
            // We need to construct this InBrowserInstance object.

            if (!browserWindow.window.isDestroyed()) {
                const instanceInfo: InBrowserInstance = {
                    id: browserWindow.id,
                    url: browserWindow.window.webContents.getURL(),
                    title: browserWindow.window.getTitle(),
                    width: browserWindow.window.getBounds().width,
                    height: browserWindow.window.getBounds().height,
                    x: browserWindow.window.getBounds().x,
                    y: browserWindow.window.getBounds().y
                };
                return [...result, instanceInfo];
            }

            return result;

        } catch (e) {
            throw e;
        }
    }

    public getIdleInBrowsers(): InBrowserInstance[] {
        const idle: InBrowserInstance[] = [];
        for (const win of this.windows.values()) {
            if (!win.window.isDestroyed() && !win.window.isVisible()) {
                idle.push({
                    id: win.id,
                    url: win.window.webContents.getURL(),
                    title: win.window.getTitle(),
                    width: win.window.getBounds().width,
                    height: win.window.getBounds().height,
                    x: win.window.getBounds().x,
                    y: win.window.getBounds().y
                });
            }
        }
        return idle;
    }

    public async setInBrowserProxy(config: Electron.ProxyConfig): Promise<boolean> {
        this.proxyConfig = config;
        // Apply to existing windows? uTools doc doesn't specify, but usually "set proxy" implies future or global.
        // Let's apply to all existing active windows for consistency.
        for (const win of this.windows.values()) {
            if (!win.window.isDestroyed()) {
                await win.window.webContents.session.setProxy(config);
            }
        }
        return true;
    }

    public async clearInBrowserCache(): Promise<boolean> {
        const sessions = new Set<Session>([session.defaultSession]);
        for (const win of this.windows.values()) {
            if (!win.window.isDestroyed()) {
                sessions.add(win.window.webContents.session);
            }
        }

        for (const activeSession of sessions) {
            await activeSession.clearCache();
        }

        return true;
    }

    public async destroyByOwner(ownerId: number): Promise<number> {
        const windowIds = Array.from(this.ownerToWindows.get(ownerId) || []);
        if (windowIds.length === 0) {
            return 0;
        }

        for (const windowId of windowIds) {
            const win = this.windows.get(windowId);
            if (!win) {
                this.releaseWindow(windowId);
                continue;
            }
            await win.destroy();
        }

        this.ownerToWindows.delete(ownerId);
        return windowIds.length;
    }

    public async destroyAll(): Promise<void> {
        const allWindows = Array.from(this.windows.values());
        for (const win of allWindows) {
            await win.destroy();
        }

        this.windows.clear();
        this.windowOwners.clear();
        this.ownerToWindows.clear();
    }
}
