import { useMemo, useState } from 'react'
import type { AiModel, AiModelParameters, AiSettings } from '../../../shared/types/ai'
import { DEFAULT_TEMPERATURE, DEFAULT_TOP_P } from './shared'
import type { GlobalDefaultModelOption } from './AiSettingsModals'
import { getProviderKey } from './providerUtils'

interface UseAiModalControllerArgs {
  aiDraft: AiSettings | null
  updateAiDraft: (patch: Partial<AiSettings>) => void
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
  resolveProviderIdFromModel: (model: AiModel) => string
}

export function useAiModalController({
  aiDraft,
  updateAiDraft,
  setAiError,
  setAiInfo,
  resolveProviderIdFromModel
}: UseAiModalControllerArgs) {
  const [showDefaultParamsModal, setShowDefaultParamsModal] = useState(false)
  const [showGlobalDefaultModelModal, setShowGlobalDefaultModelModal] = useState(false)
  const [globalDefaultModelSelection, setGlobalDefaultModelSelection] = useState('')

  const globalDefaultModelOptions = useMemo<GlobalDefaultModelOption[]>(() => {
    if (!aiDraft) return []
    const enabledProviders = (aiDraft.providers || []).filter((provider) => provider.enabled !== false)
    if (enabledProviders.length === 0) return []
    const enabledProviderMap = new Map(
      enabledProviders.map((provider) => [String(provider.id), provider] as const)
    )
    const options: GlobalDefaultModelOption[] = []
    const seenModelIds = new Set<string>()

    ;(aiDraft.models || []).forEach((model) => {
      if (!model.id) return
      const providerId = resolveProviderIdFromModel(model)
      if (!providerId) return
      const provider = enabledProviderMap.get(String(providerId))
      if (!provider) return
      if (seenModelIds.has(model.id)) return
      seenModelIds.add(model.id)
      options.push({
        id: model.id,
        label: model.label || model.id,
        providerLabel: getProviderKey(provider)
      })
    })

    enabledProviders.forEach((provider) => {
      const modelId = String(provider.defaultModel || '').trim()
      if (!modelId) return
      if (seenModelIds.has(modelId)) return
      seenModelIds.add(modelId)
      options.push({
        id: modelId,
        label: modelId,
        providerLabel: getProviderKey(provider)
      })
    })

    return options.sort((a, b) => {
      const providerCompare = a.providerLabel.localeCompare(b.providerLabel)
      if (providerCompare !== 0) return providerCompare
      return a.label.localeCompare(b.label)
    })
  }, [aiDraft, resolveProviderIdFromModel])

  const openGlobalDefaultModelModal = () => {
    const current = String(aiDraft?.defaultModel || '').trim()
    const selected =
      current && globalDefaultModelOptions.some((item) => item.id === current)
        ? current
        : (globalDefaultModelOptions[0]?.id || '')
    setGlobalDefaultModelSelection(selected)
    setShowGlobalDefaultModelModal(true)
  }

  const handleConfirmGlobalDefaultModel = () => {
    if (!aiDraft) return
    if (!globalDefaultModelSelection) {
      setAiError('请先选择一个模型')
      return
    }
    if (!globalDefaultModelOptions.some((item) => item.id === globalDefaultModelSelection)) {
      setAiError('所选模型不可用，请重新选择')
      return
    }
    updateAiDraft({ defaultModel: globalDefaultModelSelection })
    setShowGlobalDefaultModelModal(false)
    setAiError(null)
    setAiInfo(`已设置全局默认模型：${globalDefaultModelSelection}`)
  }

  const handleClearGlobalDefaultModel = () => {
    if (!aiDraft) return
    updateAiDraft({ defaultModel: undefined })
    setGlobalDefaultModelSelection('')
    setShowGlobalDefaultModelModal(false)
    setAiError(null)
    setAiInfo('已清空全局默认模型')
  }

  const handleUpdateDefaultParams = (patch: Partial<AiModelParameters>) => {
    if (!aiDraft) return
    const defaultParams = { ...(aiDraft.defaultParams || {}), ...patch }
    updateAiDraft({ defaultParams })
  }

  const handleToggleDefaultParam = (key: 'temperatureEnabled' | 'topPEnabled') => {
    if (!aiDraft) return
    const current = aiDraft.defaultParams || {}
    const nextEnabled = !(current[key] ?? false)
    const patch: Partial<AiModelParameters> = { [key]: nextEnabled }
    if (nextEnabled && key === 'temperatureEnabled' && current.temperature === undefined) {
      patch.temperature = DEFAULT_TEMPERATURE
    }
    if (nextEnabled && key === 'topPEnabled' && current.topP === undefined) {
      patch.topP = DEFAULT_TOP_P
    }
    handleUpdateDefaultParams(patch)
  }

  const handleToggleDefaultMaxTokens = () => {
    if (!aiDraft) return
    const current = aiDraft.defaultParams || {}
    const nextEnabled = !(current.maxOutputTokensEnabled ?? false)
    const patch: Partial<AiModelParameters> = { maxOutputTokensEnabled: nextEnabled }
    if (nextEnabled && current.maxOutputTokens === undefined) {
      patch.maxOutputTokens = 1024
    }
    handleUpdateDefaultParams(patch)
  }

  return {
    showDefaultParamsModal,
    showGlobalDefaultModelModal,
    globalDefaultModelSelection,
    globalDefaultModelOptions,
    setShowDefaultParamsModal,
    setShowGlobalDefaultModelModal,
    setGlobalDefaultModelSelection,
    openGlobalDefaultModelModal,
    handleConfirmGlobalDefaultModel,
    handleClearGlobalDefaultModel,
    handleUpdateDefaultParams,
    handleToggleDefaultParam,
    handleToggleDefaultMaxTokens
  }
}
