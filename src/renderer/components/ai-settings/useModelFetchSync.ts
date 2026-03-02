import { useMemo, useState } from 'react'
import type { AiModel, AiProviderConfig, AiSettings } from '../../../shared/types/ai'
import { getSystemDefaultModels } from '../../../shared/ai/systemModels'
import { getProviderKey, modelKey } from './providerUtils'

interface UseModelFetchSyncArgs {
  aiDraft: AiSettings | null
  updateAiDraft: (patch: Partial<AiSettings>) => void
  setAiError: (message: string | null) => void
  setAiInfo: (message: string | null) => void
}

export function useModelFetchSync({
  aiDraft,
  updateAiDraft,
  setAiError,
  setAiInfo
}: UseModelFetchSyncArgs) {
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<AiModel[]>([])
  const [showModelModal, setShowModelModal] = useState(false)
  const [selectedFetchedModelIds, setSelectedFetchedModelIds] = useState<Set<string>>(new Set())
  const [fetchSearch, setFetchSearch] = useState('')
  const [fetchProviderLabel, setFetchProviderLabel] = useState<string | null>(null)

  const handleFetchModels = async (provider: AiProviderConfig) => {
    setAiInfo(null)
    setAiError(null)
    if (!window.mulby?.ai?.models?.fetch) {
      setAiError('AI 接口未就绪，请重启应用')
      return
    }

    if (!provider) {
      setAiError('请选择有效的 Provider')
      return
    }

    try {
      setIsFetchingModels(true)
      setFetchProviderLabel(getProviderKey(provider))
      const result = await window.mulby.ai.models.fetch({
        providerId: String(provider.id),
        baseURL: provider.baseURL,
        apiKey: provider.apiKey
      })

      if (result.message) {
        setAiInfo(result.message)
      }

      if (!result.models || result.models.length === 0) {
        setAiError('未拉取到模型，请检查 API Key 或地址')
        return
      }

      const normalizedFetchedModels = result.models.map((model) => ({
        ...model,
        providerRef: String(provider.id),
        providerLabel: getProviderKey(provider)
      }))
      const localDefaultModels = getSystemDefaultModels()
        .filter((model) => String(model.providerRef || '') === String(provider.id))
        .map((model) => ({
          ...model,
          providerRef: String(provider.id),
          providerLabel: getProviderKey(provider)
        }))
      const mergedModels: AiModel[] = []
      const seen = new Set<string>()
      ;[...normalizedFetchedModels, ...localDefaultModels].forEach((model) => {
        const key = modelKey(model)
        if (seen.has(key)) return
        seen.add(key)
        mergedModels.push(model)
      })
      const existing = new Set((aiDraft?.models || []).map((model) => modelKey(model)))
      const selectedIds = mergedModels
        .filter((model) => existing.has(modelKey(model)))
        .map((model) => model.id)
      setFetchedModels(mergedModels)
      setSelectedFetchedModelIds(new Set(selectedIds))
      setShowModelModal(true)
    } catch (err) {
      console.error('Failed to fetch models:', err)
      setAiError('拉取模型失败')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const toggleFetchedModel = (id: string) => {
    setSelectedFetchedModelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filteredFetchedModels = useMemo(() => {
    return fetchedModels.filter((model) => {
      if (!fetchSearch.trim()) return true
      const q = fetchSearch.trim().toLowerCase()
      return model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q)
    })
  }, [fetchSearch, fetchedModels])

  const selectAllFetched = () => {
    setSelectedFetchedModelIds(new Set(filteredFetchedModels.map((model) => model.id)))
  }

  const invertFetchedSelection = () => {
    setSelectedFetchedModelIds((prev) => {
      const next = new Set(prev)
      filteredFetchedModels.forEach((model) => {
        if (next.has(model.id)) {
          next.delete(model.id)
        } else {
          next.add(model.id)
        }
      })
      return next
    })
  }

  const handleAddFetchedModels = () => {
    if (!aiDraft) return

    const fetchedKeySet = new Set(fetchedModels.map((model) => modelKey(model)))
    const selectedFetchedModels = fetchedModels.filter((model) => selectedFetchedModelIds.has(model.id))
    const selectedFetchedKeySet = new Set(selectedFetchedModels.map((model) => modelKey(model)))

    const currentModels = aiDraft.models || []
    const keptModels = currentModels.filter((model) => {
      const key = modelKey(model)
      if (!fetchedKeySet.has(key)) return true
      return selectedFetchedKeySet.has(key)
    })
    const keptKeySet = new Set(keptModels.map((model) => modelKey(model)))
    const toAdd = selectedFetchedModels.filter((model) => !keptKeySet.has(modelKey(model)))
    const nextModels = [...keptModels, ...toAdd]

    const removedCount = currentModels.length - keptModels.length
    const addedCount = toAdd.length
    updateAiDraft({ models: nextModels })
    if (addedCount > 0 || removedCount > 0) {
      setAiInfo(`模型已同步：新增 ${addedCount} 个，移除 ${removedCount} 个`)
    } else {
      setAiInfo('模型无变化')
    }
    setShowModelModal(false)
  }

  return {
    isFetchingModels,
    showModelModal,
    fetchProviderLabel,
    fetchSearch,
    filteredFetchedModels,
    selectedFetchedModelIds,
    setShowModelModal,
    setFetchSearch,
    handleFetchModels,
    selectAllFetched,
    invertFetchedSelection,
    toggleFetchedModel,
    handleAddFetchedModels
  }
}
