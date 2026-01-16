import { BrowserWindow, session } from 'electron';
import { InBrowserWindow } from './InBrowserWindow';
import { InBrowserRunPayload, InBrowserOptions, InBrowserInstance } from '../../shared/types/inbrowser';

export class InBrowserManager {
    private static instance: InBrowserManager;
    private windows: Map<number, InBrowserWindow> = new Map();
    private proxyConfig: Electron.ProxyConfig | null = null;

    private constructor() { }

    public static getInstance(): InBrowserManager {
        if (!InBrowserManager.instance) {
            InBrowserManager.instance = new InBrowserManager();
        }
        return InBrowserManager.instance;
    }

    public async run(payload: InBrowserRunPayload): Promise<any[]> {
        let browserWindow: InBrowserWindow;

        // TODO: Support reusing windows via ID or Idle Pool
        // For Phase 1, we just create a new window every time if ID is not provided.
        // Ideally, if ID is provided, we reuse.

        if (payload.id && this.windows.has(payload.id)) {
            browserWindow = this.windows.get(payload.id)!;
        } else {
            // Default options if none provided
            const options: InBrowserOptions = payload.options || {
                show: false,
                width: 800,
                height: 600
            };
            browserWindow = new InBrowserWindow(options);
            this.windows.set(browserWindow.id, browserWindow);

            // Handle window close to cleanup map
            browserWindow.window.on('closed', () => {
                this.windows.delete(browserWindow.id);
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
        await session.defaultSession.clearCache();
        return true;
    }
}
