
import { InBrowserWindow } from './InBrowserWindow';
import { InBrowserRunPayload, InBrowserOptions } from '../../shared/types/inbrowser';

export class InBrowserManager {
    private static instance: InBrowserManager;
    private windows: Map<number, InBrowserWindow> = new Map();

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
                // For now, adhering to uTools behavior of returning the ID.
                return [...result, { id: browserWindow.id }];
            }

            return result;

        } catch (e) {
            throw e;
        }
    }
}
