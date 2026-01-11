import { ipcMain } from 'electron'
import { PluginHttp } from '../plugin/http'

const pluginHttp = new PluginHttp()

export function registerHttpHandlers() {
    ipcMain.handle('http:request', async (_, options) => {
        return pluginHttp.request(options)
    })

    ipcMain.handle('http:get', async (_, url, headers) => {
        return pluginHttp.get(url, headers)
    })

    ipcMain.handle('http:post', async (_, url, body, headers) => {
        return pluginHttp.post(url, body, headers)
    })

    ipcMain.handle('http:put', async (_, url, body, headers) => {
        return pluginHttp.put(url, body, headers)
    })

    ipcMain.handle('http:delete', async (_, url, headers) => {
        return pluginHttp.delete(url, headers)
    })
}
