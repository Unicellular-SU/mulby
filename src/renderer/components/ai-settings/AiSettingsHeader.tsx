import {
  SettingsLikePageHeader,
  settingsLikeHeaderGhostButtonClass,
  settingsLikeHeaderPrimaryButtonClass
} from '../SettingsLikePageChrome'

interface AiSettingsHeaderProps {
  hasProviderBlockingIssues: boolean
  onBack: () => void
  onOpenGlobalDefaultModelModal: () => void
  onOpenDefaultParamsModal: () => void
  onOpenSkillsSettings?: () => void
  onOpenMcpSettings?: () => void
  onReset: () => void
  onSave: () => void
}

export default function AiSettingsHeader({
  hasProviderBlockingIssues,
  onBack,
  onOpenGlobalDefaultModelModal,
  onOpenDefaultParamsModal,
  onOpenSkillsSettings,
  onOpenMcpSettings,
  onReset,
  onSave
}: AiSettingsHeaderProps) {
  return (
    <SettingsLikePageHeader
      eyebrow="AI Settings"
      title="AI 配置中心"
      onBack={onBack}
      actions={(
        <>
          <button
            type="button"
            className={settingsLikeHeaderGhostButtonClass}
            onClick={onOpenGlobalDefaultModelModal}
            title="设置未指定模型时使用的全局默认模型"
          >
            默认模型
          </button>
          <button
            type="button"
            className={settingsLikeHeaderGhostButtonClass}
            onClick={onOpenDefaultParamsModal}
            title="配置全局默认参数"
          >
            默认参数
          </button>
          {onOpenSkillsSettings && (
            <button
              type="button"
              className={settingsLikeHeaderGhostButtonClass}
              onClick={onOpenSkillsSettings}
              title="进入 Skills 创建、安装与预览管理"
            >
              Skills 管理
            </button>
          )}
          {onOpenMcpSettings && (
            <button
              type="button"
              className={settingsLikeHeaderGhostButtonClass}
              onClick={onOpenMcpSettings}
              title="进入 MCP 服务器与工具策略管理"
            >
              MCP 管理
            </button>
          )}
          <button
            type="button"
            className={settingsLikeHeaderGhostButtonClass}
            onClick={onReset}
            title="恢复到上次保存的配置"
          >
            恢复
          </button>
          <button
            type="button"
            className={settingsLikeHeaderPrimaryButtonClass}
            onClick={onSave}
            disabled={hasProviderBlockingIssues}
            title={hasProviderBlockingIssues ? '存在 Provider 配置错误，请先修复' : '保存'}
          >
            保存
          </button>
        </>
      )}
    />
  )
}
