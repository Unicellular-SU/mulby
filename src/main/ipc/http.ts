import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { PluginHttp, type HttpRequestOptions, type HttpResponse } from '../plugin/http'
import { getPluginIdForWebContents } from '../services/ipc-caller-resolver'
import { pluginNetworkChannel, truncatePreview } from '../plugin/plugin-network-channel'

const pluginHttp = new PluginHttp()

/** 开发者模式下把一次 mulby.http 调用上报给网络日志桥（按 webContents 归属到插件） */
function reportHttp(
    event: IpcMainInvokeEvent,
    options: HttpRequestOptions,
    response: HttpResponse | undefined,
    error: unknown,
    startedAt: number
): void {
    if (!pluginNetworkChannel.enabled) return
    const pluginId = getPluginIdForWebContents(event.sender)
    if (!pluginId) return
    const status = response?.status
    pluginNetworkChannel.report(pluginId, {
        source: 'mulby.http',
        method: options.method || 'GET',
        url: options.url,
        status,
        statusText: response?.statusText,
        ok: status != null ? status >= 200 && status < 400 : undefined,
        durationMs: Date.now() - startedAt,
        startedAt,
        requestHeaders: options.headers,
        requestBodyPreview: truncatePreview(options.body),
        responseHeaders: response?.headers,
        responseBodyPreview: response ? truncatePreview(response.data) : undefined,
        error: error ? (error instanceof Error ? error.message : String(error)) : undefined
    })
}

/** 执行 http 请求并在开发者模式下上报（行为与直接调用 PluginHttp 完全一致） */
async function runHttp(
    event: IpcMainInvokeEvent,
    options: HttpRequestOptions,
    exec: () => Promise<HttpResponse>
): Promise<HttpResponse> {
    const startedAt = Date.now()
    try {
        const response = await exec()
        reportHttp(event, options, response, undefined, startedAt)
        return response
    } catch (error) {
        reportHttp(event, options, undefined, error, startedAt)
        throw error
    }
}

export function registerHttpHandlers() {
    ipcMain.handle('http:request', (event, options: HttpRequestOptions) =>
        runHttp(event, options, () => pluginHttp.request(options)))

    ipcMain.handle('http:get', (event, url: string, headers?: Record<string, string>) =>
        runHttp(event, { url, method: 'GET', headers }, () => pluginHttp.get(url, headers)))

    ipcMain.handle('http:post', (event, url: string, body: string | object | Buffer | ArrayBuffer, headers?: Record<string, string>) =>
        runHttp(event, { url, method: 'POST', headers, body }, () => pluginHttp.post(url, body, headers)))

    ipcMain.handle('http:put', (event, url: string, body: string | object | Buffer | ArrayBuffer, headers?: Record<string, string>) =>
        runHttp(event, { url, method: 'PUT', headers, body }, () => pluginHttp.put(url, body, headers)))

    ipcMain.handle('http:delete', (event, url: string, headers?: Record<string, string>) =>
        runHttp(event, { url, method: 'DELETE', headers }, () => pluginHttp.delete(url, headers)))
}
