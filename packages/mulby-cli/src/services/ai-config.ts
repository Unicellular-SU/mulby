import inquirer from 'inquirer'
import { ConfigManager } from './config-manager'
import {
  AIConfig,
  type AIProviderConfig,
  type AIProviderType,
  PROVIDER_MODELS,
  PROVIDER_ENDPOINTS
} from '../types/ai'

export const PROVIDER_CHOICES: Array<{ name: string; value: AIProviderType }> = [
  { name: 'OpenAI', value: 'openai' },
  { name: 'Claude (Anthropic)', value: 'claude' },
  { name: 'DeepSeek', value: 'deepseek' },
  { name: 'Gemini (Google)', value: 'gemini' },
  { name: 'GLM', value: 'glm' },
  { name: 'MiniMax', value: 'minimax' },
  { name: 'Custom', value: 'custom' }
]

export function getAiConfig(configManager: ConfigManager): AIConfig {
  return configManager.get<AIConfig>('ai') || { providers: {} }
}

export function suggestProviderName(aiConfig: AIConfig, provider: AIProviderType, preferredName?: string): string {
  const trimmedPreferred = preferredName?.trim()
  if (trimmedPreferred) {
    return trimmedPreferred
  }

  const providerNames = Object.keys(aiConfig.providers || {})
  if (providerNames.length === 0) {
    return 'default'
  }

  if (!aiConfig.providers[provider]) {
    return provider
  }

  let index = 2
  while (aiConfig.providers[`${provider}-${index}`]) {
    index += 1
  }
  return `${provider}-${index}`
}

export function resolveDefaultConfigName(aiConfig: AIConfig): string | undefined {
  if (aiConfig.default && aiConfig.providers[aiConfig.default]) {
    return aiConfig.default
  }

  const names = Object.keys(aiConfig.providers || {})
  if (names.length === 1) {
    return names[0]
  }

  return undefined
}

export interface PromptProviderConfigOptions {
  provider?: AIProviderType
  apiKey?: string
  model?: string
  endpoint?: string
}

export async function promptForProviderConfig(
  existingConfig?: AIProviderConfig,
  initialOptions: PromptProviderConfigOptions = {}
): Promise<AIProviderConfig> {
  let provider = initialOptions.provider || existingConfig?.provider

  if (!provider) {
    const { selectedProvider } = await inquirer.prompt<{ selectedProvider: AIProviderType }>([{
      type: 'list',
      name: 'selectedProvider',
      message: '选择 AI 提供商',
      choices: PROVIDER_CHOICES,
      default: 'openai'
    }])
    provider = selectedProvider
  } else if (!initialOptions.provider) {
    const { selectedProvider } = await inquirer.prompt<{ selectedProvider: AIProviderType }>([{
      type: 'list',
      name: 'selectedProvider',
      message: '选择 AI 提供商',
      choices: PROVIDER_CHOICES,
      default: provider
    }])
    provider = selectedProvider
  }

  let inputKey = initialOptions.apiKey
  if (!inputKey) {
    const { promptedKey } = await inquirer.prompt<{ promptedKey: string }>([{
      type: 'password',
      name: 'promptedKey',
      message: existingConfig?.apiKey ? '输入 API Key（留空保持不变）:' : '输入 API Key:',
      validate: (input: string) => {
        if (existingConfig?.apiKey) return true
        return input.length > 0 || 'API Key 不能为空'
      }
    }])
    inputKey = promptedKey
  }

  const presetModels = PROVIDER_MODELS[provider] || []
  let model = initialOptions.model
    || (existingConfig?.provider === provider ? existingConfig?.model : undefined)
  if (presetModels.length > 0) {
    if (!model || !presetModels.includes(model)) {
      const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([{
        type: 'list',
        name: 'selectedModel',
        message: '选择模型',
        choices: presetModels,
        default: model && presetModels.includes(model) ? model : presetModels[0]
      }])
      model = selectedModel
    }
  }

  let apiEndpoint = initialOptions.endpoint
    || (provider === existingConfig?.provider
      ? existingConfig?.apiEndpoint
      : PROVIDER_ENDPOINTS[provider])

  if (provider === 'custom') {
    if (!apiEndpoint) {
      const { inputEndpoint } = await inquirer.prompt<{ inputEndpoint: string }>([{
        type: 'input',
        name: 'inputEndpoint',
        message: '输入 API 端点:',
        default: apiEndpoint,
        validate: (input: string) => input.length > 0 || 'API 端点不能为空'
      }])
      apiEndpoint = inputEndpoint
    }
  }

  return {
    provider,
    apiKey: inputKey || existingConfig?.apiKey || '',
    model,
    apiEndpoint
  }
}

export function saveProviderConfig(
  configManager: ConfigManager,
  name: string,
  config: AIProviderConfig,
  options: { setAsDefault?: boolean } = {}
): AIConfig {
  const aiConfig = getAiConfig(configManager)
  aiConfig.providers[name] = config

  if (options.setAsDefault || !aiConfig.default) {
    aiConfig.default = name
  }

  configManager.set('ai', aiConfig)
  return aiConfig
}
