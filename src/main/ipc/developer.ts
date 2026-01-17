import { ipcMain, dialog } from 'electron'
import { existsSync } from 'fs'
import { appSettingsManager } from '../services/app-settings'
import { PluginManager } from '../plugin'

/**
 * 开发者模式相关的 IPC 处理器
 */
export function registerDeveloperHandlers(pluginManager: PluginManager) {
    // 添加开发目录
    ipcMain.handle('developer:addPluginPath', async (_event, path: string) => {
        const settings = appSettingsManager.getSettings()

        if (settings.developer.pluginPaths.includes(path)) {
            return { success: false, error: '目录已存在' }
        }

        if (!existsSync(path)) {
            return { success: false, error: '目录不存在' }
        }

        appSettingsManager.updateSettings({
            developer: {
                ...settings.developer,
                pluginPaths: [...settings.developer.pluginPaths, path]
            }
        })

        // 重新加载插件
        await pluginManager.init()

        return { success: true }
    })

    // 移除开发目录
    ipcMain.handle('developer:removePluginPath', async (_event, path: string) => {
        const settings = appSettingsManager.getSettings()

        appSettingsManager.updateSettings({
            developer: {
                ...settings.developer,
                pluginPaths: settings.developer.pluginPaths.filter(p => p !== path)
            }
        })

        // 重新加载插件
        await pluginManager.init()

        return { success: true }
    })

    // 刷新插件
    ipcMain.handle('developer:reloadPlugins', async () => {
        await pluginManager.init()
        return { success: true }
    })

    // 选择目录对话框
    ipcMain.handle('developer:selectDirectory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: '选择插件开发目录'
        })

        if (result.canceled || result.filePaths.length === 0) {
            return null
        }

        return result.filePaths[0]
    })
}
