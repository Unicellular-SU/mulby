import { ipcMain } from 'electron'
import type { AppSettings } from '../../shared/types/settings'
import type { AiProviderConfig } from '../../shared/types/ai'
import { AppSettingsManager } from '../services/app-settings'
import { AppShortcutManager } from '../services/app-shortcuts'
import { ThemeManager } from '../services/theme'
import { OnboardingWindowManager } from '../services/onboarding-window'
import { getAiSettings, updateAiSettings } from '../ai/config'
import { appOnlyInvoke } from './_shared/caller-middleware'

export function registerOnboardingHandlers(
  settingsManager: AppSettingsManager,
  shortcutManager: AppShortcutManager,
  themeManager: ThemeManager,
  onboardingWindowManager: OnboardingWindowManager
) {
  // 获取引导所需的当前设置
  ipcMain.handle('onboarding:getSettings', appOnlyInvoke(() => {
    const appSettings = settingsManager.getSettings()
    const aiSettings = getAiSettings()
    return {
      shortcuts: appSettings.shortcuts,
      storeSources: appSettings.storeSources,
      superPanel: appSettings.superPanel,
      theme: themeManager.getMode(),
      aiProviders: aiSettings.providers || [],
      onboardingCompleted: appSettings.onboardingCompleted ?? false
    }
  }))

  // 更新快捷键
  ipcMain.handle('onboarding:updateShortcut', appOnlyInvoke((_event, action: string, accelerator: string) => {
    if (action !== 'toggleWindow' && action !== 'openSettings') return false
    const partial: Partial<AppSettings> = {
      shortcuts: { ...settingsManager.getSettings().shortcuts, [action]: accelerator }
    }
    settingsManager.updateSettings(partial)
    shortcutManager.apply(settingsManager.getSettings().shortcuts)
    return true
  }))

  // 更新主题
  ipcMain.handle('onboarding:updateTheme', appOnlyInvoke((_event, mode: string) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return false
    themeManager.setMode(mode)
    return true
  }))

  // 保存 AI Provider 配置（使用 ai/config.ts 的正规接口）
  ipcMain.handle('onboarding:updateAiProvider', appOnlyInvoke((_event, provider: AiProviderConfig) => {
    if (!provider || !provider.id) return false
    const aiSettings = getAiSettings()
    const existingIndex = aiSettings.providers.findIndex(p => p.id === provider.id)
    const nextProviders = [...aiSettings.providers]
    if (existingIndex >= 0) {
      nextProviders[existingIndex] = { ...nextProviders[existingIndex], ...provider }
    } else {
      nextProviders.push(provider)
    }
    updateAiSettings({ providers: nextProviders })
    return true
  }))

  // 保存插件商店源
  ipcMain.handle('onboarding:updateStoreSources', appOnlyInvoke((_event, sources: AppSettings['storeSources']) => {
    if (!Array.isArray(sources)) return false
    settingsManager.updateSettings({ storeSources: sources })
    return true
  }))

  // 保存超级面板设置
  ipcMain.handle('onboarding:updateSuperPanel', appOnlyInvoke((_event, superPanel: AppSettings['superPanel']) => {
    if (!superPanel || typeof superPanel !== 'object') return false
    settingsManager.updateSettings({ superPanel })
    return true
  }))

  // 标记引导完成并关闭窗口
  ipcMain.handle('onboarding:complete', appOnlyInvoke(() => {
    settingsManager.updateSettings({ onboardingCompleted: true })
    onboardingWindowManager.markCompleted()
    onboardingWindowManager.close()
    return true
  }))
}
