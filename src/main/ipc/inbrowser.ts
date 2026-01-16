import { ipcMain } from 'electron';
import { InBrowserManager } from '../browser/InBrowserManager';
import { InBrowserRunPayload } from '../../shared/types/inbrowser';

export function registerInBrowserHandlers() {
    ipcMain.handle('inbrowser:run', async (_event, payload: InBrowserRunPayload) => {
        try {
            const result = await InBrowserManager.getInstance().run(payload);
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
