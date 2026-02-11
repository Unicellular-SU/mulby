import { ipcMain } from 'electron';
import { InBrowserManager } from '../browser/InBrowserManager';
import { InBrowserRunPayload } from '../../shared/types/inbrowser';

export function registerInBrowserHandlers() {
    const cleanupBoundSenders = new Set<number>();

    ipcMain.handle('inbrowser:run', async (event, payload: InBrowserRunPayload) => {
        try {
            const manager = InBrowserManager.getInstance();
            const senderId = event.sender.id;

            if (!cleanupBoundSenders.has(senderId)) {
                cleanupBoundSenders.add(senderId);
                event.sender.once('destroyed', () => {
                    void manager.destroyByOwner(senderId).catch((error) => {
                        console.warn(`[InBrowser] Failed to cleanup windows for sender ${senderId}:`, error);
                    });
                    cleanupBoundSenders.delete(senderId);
                });
            }

            const result = await manager.run(payload, senderId);
            return result;
        } catch (error: any) {
            console.error('InBrowser IPC Error:', error);
            throw error; // Re-throw to renderer
        }
    });

    ipcMain.handle('inbrowser:getIdleInBrowsers', async () => {
        return InBrowserManager.getInstance().getIdleInBrowsers();
    });

    ipcMain.handle('inbrowser:setInBrowserProxy', async (_event, config: Electron.ProxyConfig) => {
        return await InBrowserManager.getInstance().setInBrowserProxy(config);
    });

    ipcMain.handle('inbrowser:clearInBrowserCache', async () => {
        return await InBrowserManager.getInstance().clearInBrowserCache();
    });
}
