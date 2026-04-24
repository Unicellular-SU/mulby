import { ipcMain } from 'electron'
import { PluginFilesystem } from '../plugin/filesystem'
import { pluginAwareInvoke } from './_shared/caller-middleware'
import type { IpcCallerInfo } from '../services/ipc-caller-resolver'

/**
 * Filesystem IPC 调用方隔离
 *
 * 旧版本：单一全局 `new PluginFilesystem()`（无 pluginName）→ 仅系统路径黑名单生效，
 * 跨插件 plugin-data 边界保护被跳过，等价于任何插件可读写/删除别人的私有数据。
 *
 * 新版本：
 *  - 主应用：复用无 pluginName 的单例（允许访问完整文件系统，除去系统路径）
 *  - 插件：按 pluginId 缓存独立实例，`PluginFilesystem.checkRead/Write/Delete`
 *    会在访问 `userData/plugin-data/<其它插件>/...` 时抛 `PluginSecurityError`
 *
 * 详见 `docs/code-review-architecture-2026-04-17.md` H2 与 M2。
 */

/** 主应用无插件上下文使用的共享实例（保持向后兼容） */
const appFilesystem = new PluginFilesystem()

/** 按 pluginId 缓存插件 Filesystem 实例 —— 构造会 mkdir 插件私有目录，不宜 per-request 重建 */
const pluginFilesystemCache = new Map<string, PluginFilesystem>()

function getFilesystem(caller: IpcCallerInfo): PluginFilesystem {
    if (caller.source === 'plugin' && caller.pluginId) {
        const cached = pluginFilesystemCache.get(caller.pluginId)
        if (cached) return cached
        const fs = new PluginFilesystem(caller.pluginId)
        pluginFilesystemCache.set(caller.pluginId, fs)
        return fs
    }
    return appFilesystem
}

export function registerFilesystemHandlers() {
    // 读取文件
    ipcMain.handle('filesystem:readFile', pluginAwareInvoke((caller, _event, path: string, encoding?: 'utf-8' | 'base64') => {
        return getFilesystem(caller).readFile(path, encoding)
    }))

    // 写入文件（受系统路径黑名单 + 跨插件隔离保护）
    ipcMain.handle('filesystem:writeFile', pluginAwareInvoke((caller, _event, path: string, data: string | Buffer | ArrayBuffer, encoding?: 'utf-8' | 'base64') => {
        getFilesystem(caller).writeFile(path, data, encoding)
    }))

    // 检查文件是否存在
    ipcMain.handle('filesystem:exists', pluginAwareInvoke((caller, _event, path: string) => {
        return getFilesystem(caller).exists(path)
    }))

    // 删除文件（受系统路径黑名单 + 跨插件隔离保护）
    ipcMain.handle('filesystem:unlink', pluginAwareInvoke((caller, _event, path: string) => {
        getFilesystem(caller).unlink(path)
    }))

    // 读取目录
    ipcMain.handle('filesystem:readdir', pluginAwareInvoke((caller, _event, path: string) => {
        return getFilesystem(caller).readdir(path)
    }))

    // 创建目录（受系统路径黑名单 + 跨插件隔离保护）
    ipcMain.handle('filesystem:mkdir', pluginAwareInvoke((caller, _event, path: string) => {
        getFilesystem(caller).mkdir(path)
    }))

    // 获取文件信息
    ipcMain.handle('filesystem:stat', pluginAwareInvoke((caller, _event, path: string) => {
        return getFilesystem(caller).stat(path)
    }))

    // 复制文件（受系统路径黑名单 + 跨插件隔离保护）
    ipcMain.handle('filesystem:copy', pluginAwareInvoke((caller, _event, src: string, dest: string) => {
        getFilesystem(caller).copy(src, dest)
    }))

    // 移动/重命名文件（受系统路径黑名单 + 跨插件隔离保护）
    ipcMain.handle('filesystem:move', pluginAwareInvoke((caller, _event, src: string, dest: string) => {
        getFilesystem(caller).move(src, dest)
    }))
}
