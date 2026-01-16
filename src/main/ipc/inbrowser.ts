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
}
