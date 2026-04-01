import {
  SettingsLikePageHeader,
  settingsLikeHeaderGhostButtonClass
} from '../SettingsLikePageChrome'

interface AiSettingsHeaderProps {
  onBack: () => void
  onOpenGlobalDefaultModelModal: () => void
  onOpenDefaultParamsModal: () => void
  onOpenToolSettings?: () => void
  onOpenSkillsSettings?: () => void
  onOpenMcpSettings?: () => void
}

export default function AiSettingsHeader({
  onBack,
  onOpenGlobalDefaultModelModal,
  onOpenDefaultParamsModal,
  onOpenToolSettings,
  onOpenSkillsSettings,
  onOpenMcpSettings
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
          {onOpenToolSettings && (
            <button
              type="button"
              className={settingsLikeHeaderGhostButtonClass}
              onClick={onOpenToolSettings}
              title="配置 Web Search 搜索引擎和 API 密钥"
            >
              工具设置
            </button>
          )}
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
        </>
      )}
    />
  )
}

