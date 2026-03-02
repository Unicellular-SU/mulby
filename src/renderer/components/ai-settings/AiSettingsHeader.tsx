interface AiSettingsHeaderProps {
  pillClass: string
  primaryPillClass: string
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
  pillClass,
  primaryPillClass,
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
    <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
      <button
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
        title="返回"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="flex-1">
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">AI Settings</div>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI 配置中心</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className={`${pillClass} no-drag`}
          onClick={onOpenGlobalDefaultModelModal}
          title="设置未指定模型时使用的全局默认模型"
        >
          默认模型
        </button>
        <button className={`${pillClass} no-drag`} onClick={onOpenDefaultParamsModal} title="配置全局默认参数">
          默认参数
        </button>
        {onOpenSkillsSettings && (
          <button className={`${pillClass} no-drag`} onClick={onOpenSkillsSettings} title="进入 Skills 创建、安装与预览管理">
            Skills 管理
          </button>
        )}
        {onOpenMcpSettings && (
          <button className={`${pillClass} no-drag`} onClick={onOpenMcpSettings} title="进入 MCP 服务器与工具策略管理">
            MCP 管理
          </button>
        )}
        <button className={`${pillClass} no-drag`} onClick={onReset} title="恢复到上次保存的配置">恢复</button>
        <button
          className={`${primaryPillClass} no-drag disabled:cursor-not-allowed disabled:opacity-60`}
          onClick={onSave}
          disabled={hasProviderBlockingIssues}
          title={hasProviderBlockingIssues ? '存在 Provider 配置错误，请先修复' : '保存'}
        >
          保存
        </button>
      </div>
    </div>
  )
}
