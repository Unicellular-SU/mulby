import { Command } from 'commander'
import inquirer from 'inquirer'
import chalk from 'chalk'
import { ConfigManager } from '../services/config-manager'
import {
  AIConfig,
  type AIProviderConfig,
  type AIProviderType,
  PROVIDER_MODELS,
  PROVIDER_ENDPOINTS
} from '../types/ai'

interface AddAiConfigOptions {
  provider?: AIProviderType
  apiKey?: string
  model?: string
  endpoint?: string
}

interface UpdateAiConfigOptions {
  apiKey?: string
  model?: string
  endpoint?: string
}

const PROVIDER_CHOICES: Array<{ name: string; value: AIProviderType }> = [
  { name: 'OpenAI', value: 'openai' },
  { name: 'Claude (Anthropic)', value: 'claude' },
  { name: 'DeepSeek', value: 'deepseek' },
  { name: 'Gemini (Google)', value: 'gemini' },
  { name: 'GLM', value: 'glm' },
  { name: 'MiniMax', value: 'minimax' },
  { name: 'Custom', value: 'custom' }
]

function getAiConfig(configManager: ConfigManager): AIConfig {
  return configManager.get<AIConfig>('ai') || { providers: {} }
}

function ensureProviderExists(aiConfig: AIConfig, name: string): AIProviderConfig | null {
  if (!aiConfig.providers || !aiConfig.providers[name]) {
    console.log(chalk.yellow(`配置 "${name}" 不存在`))
    return null
  }
  return aiConfig.providers[name]
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '***'
  }
  return `${key.slice(0, 4)}***${key.slice(-4)}`
}

export function createAIConfigCommand() {
  const command = new Command('ai')
    .description('管理 AI 提供商配置')

  command
    .command('add <name>')
    .description('新增 AI 提供商配置')
    .option('-p, --provider <provider>', '提供商类型')
    .option('-k, --api-key <key>', 'API Key')
    .option('-m, --model <model>', '模型名称')
    .option('-e, --endpoint <url>', 'API 端点')
    .action(async (name: string, options: AddAiConfigOptions) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)

        if (aiConfig.providers[name]) {
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
            type: 'confirm',
            name: 'confirm',
            message: `配置 "${name}" 已存在，是否覆盖？`,
            default: false
          }])
          if (!confirm) {
            console.log(chalk.yellow('已取消'))
            return
          }
        }

        let provider = options.provider
        let apiKey = options.apiKey
        let model = options.model
        let endpoint = options.endpoint

        if (!provider) {
          const { selectedProvider } = await inquirer.prompt<{ selectedProvider: AIProviderType }>([{
            type: 'list',
            name: 'selectedProvider',
            message: '选择 AI 提供商',
            choices: PROVIDER_CHOICES
          }])
          provider = selectedProvider
        }

        if (!apiKey) {
          const { inputKey } = await inquirer.prompt<{ inputKey: string }>([{
            type: 'password',
            name: 'inputKey',
            message: '输入 API Key:',
            validate: (input: string) => input.length > 0 || 'API Key 不能为空'
          }])
          apiKey = inputKey
        }

        const presetModels = provider ? PROVIDER_MODELS[provider] : []
        if (!model && presetModels.length > 0) {
          const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([{
            type: 'list',
            name: 'selectedModel',
            message: '选择模型',
            choices: presetModels,
            default: presetModels[0]
          }])
          model = selectedModel
        }

        if (!endpoint) {
          if (provider === 'custom') {
            const { inputEndpoint } = await inquirer.prompt<{ inputEndpoint: string }>([{
              type: 'input',
              name: 'inputEndpoint',
              message: '输入 API 端点:',
              validate: (input: string) => input.length > 0 || 'API 端点不能为空'
            }])
            endpoint = inputEndpoint
          } else if (provider) {
            endpoint = PROVIDER_ENDPOINTS[provider]
          }
        }

        aiConfig.providers[name] = {
          provider: provider as AIProviderType,
          apiKey: apiKey || '',
          model,
          apiEndpoint: endpoint
        }

        if (!aiConfig.default) {
          aiConfig.default = name
        }

        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已保存配置 "${name}"`))
        if (aiConfig.default === name) {
          console.log(chalk.blue('当前为默认配置'))
        }
      } catch (error) {
        console.error(chalk.red('添加配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('list')
    .alias('ls')
    .description('列出所有 AI 配置')
    .action(() => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const entries = Object.entries(aiConfig.providers || {})

        if (entries.length === 0) {
          console.log(chalk.yellow('还没有 AI 配置'))
          console.log(chalk.gray('使用 `mulby ai add <name>` 添加配置'))
          return
        }

        console.log(chalk.bold('\nAI 配置列表\n'))
        for (const [name, config] of entries) {
          const isDefault = aiConfig.default === name
          console.log(`${isDefault ? chalk.green('* ') : '  '}${chalk.bold(name)}${isDefault ? chalk.gray(' (默认)') : ''}`)
          console.log(`  ${chalk.gray('提供商:')} ${config.provider}`)
          console.log(`  ${chalk.gray('模型:')} ${config.model || '未指定'}`)
          console.log(`  ${chalk.gray('API Key:')} ${maskApiKey(config.apiKey)}`)
          if (config.apiEndpoint) {
            console.log(`  ${chalk.gray('端点:')} ${config.apiEndpoint}`)
          }
          console.log()
        }
      } catch (error) {
        console.error(chalk.red('列出配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('remove <name>')
    .alias('rm')
    .description('删除指定 AI 配置')
    .action(async (name: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        if (!ensureProviderExists(aiConfig, name)) {
          return
        }

        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `确定删除配置 "${name}" 吗？`,
          default: false
        }])
        if (!confirm) {
          console.log(chalk.yellow('已取消'))
          return
        }

        delete aiConfig.providers[name]
        if (aiConfig.default === name) {
          aiConfig.default = Object.keys(aiConfig.providers)[0]
        }

        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已删除配置 "${name}"`))
        if (aiConfig.default) {
          console.log(chalk.blue(`默认配置已切换为 "${aiConfig.default}"`))
        }
      } catch (error) {
        console.error(chalk.red('删除配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('use <name>')
    .description('设置默认 AI 配置')
    .action((name: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        if (!ensureProviderExists(aiConfig, name)) {
          return
        }

        aiConfig.default = name
        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已将 "${name}" 设为默认配置`))
      } catch (error) {
        console.error(chalk.red('设置默认配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('show <name>')
    .description('查看指定 AI 配置详情')
    .action((name: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const config = ensureProviderExists(aiConfig, name)
        if (!config) {
          return
        }

        console.log(chalk.bold(`\n配置: ${name}`) + (aiConfig.default === name ? chalk.gray(' (默认)') : ''))
        console.log(chalk.gray('-'.repeat(50)))
        console.log(`${chalk.gray('提供商:')} ${config.provider}`)
        console.log(`${chalk.gray('模型:')} ${config.model || '未指定'}`)
        console.log(`${chalk.gray('API Key:')} ${maskApiKey(config.apiKey)}`)
        if (config.apiEndpoint) {
          console.log(`${chalk.gray('端点:')} ${config.apiEndpoint}`)
        }
        console.log(`${chalk.gray('最大重试:')} ${config.maxRetries || 3}`)
        console.log(`${chalk.gray('超时时间:')} ${config.timeout || 60}s`)
        console.log(`${chalk.gray('流式输出:')} ${config.streaming !== false ? '是' : '否'}`)
        if (config.maxTokens) {
          console.log(`${chalk.gray('最大 Tokens:')} ${config.maxTokens}`)
        }
        console.log()
      } catch (error) {
        console.error(chalk.red('查看配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('update <name>')
    .description('更新已有 AI 配置')
    .option('-k, --api-key <key>', '更新 API Key')
    .option('-m, --model <model>', '更新模型')
    .option('-e, --endpoint <url>', '更新 API 端点')
    .action((name: string, options: UpdateAiConfigOptions) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const config = ensureProviderExists(aiConfig, name)
        if (!config) {
          return
        }

        let updated = false
        if (options.apiKey) {
          config.apiKey = options.apiKey
          updated = true
        }
        if (options.model) {
          config.model = options.model
          updated = true
        }
        if (options.endpoint) {
          config.apiEndpoint = options.endpoint
          updated = true
        }

        if (!updated) {
          console.log(chalk.yellow('没有检测到需要更新的字段'))
          console.log(chalk.gray('使用 --api-key、--model 或 --endpoint'))
          return
        }

        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已更新配置 "${name}"`))
      } catch (error) {
        console.error(chalk.red('更新配置失败:'), toErrorMessage(error))
      }
    })

  return command
}
