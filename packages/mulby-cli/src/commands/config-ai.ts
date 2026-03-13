import { Command } from 'commander'
import inquirer from 'inquirer'
import chalk from 'chalk'
import { ConfigManager } from '../services/config-manager'
import {
  AIConfig,
  type AIProviderConfig
} from '../types/ai'
import {
  getAiConfig,
  promptForProviderConfig,
  resolveDefaultConfigName,
  saveProviderConfig,
  suggestProviderName
} from '../services/ai-config'

interface AddAiConfigOptions {
  provider?: 'openai' | 'claude' | 'deepseek' | 'gemini' | 'glm' | 'minimax' | 'custom'
  apiKey?: string
  model?: string
  endpoint?: string
}

interface UpdateAiConfigOptions {
  apiKey?: string
  model?: string
  endpoint?: string
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
    .command('setup')
    .description('快速配置默认 AI 提供商（推荐）')
    .action(async () => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const currentDefaultName = resolveDefaultConfigName(aiConfig)
        const currentDefaultConfig = currentDefaultName ? aiConfig.providers[currentDefaultName] : undefined
        const targetName = currentDefaultName || 'default'

        if (currentDefaultConfig) {
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
            type: 'confirm',
            name: 'confirm',
            message: `默认配置 "${targetName}" 已存在，是否覆盖？`,
            default: false
          }])
          if (!confirm) {
            console.log(chalk.yellow('已取消'))
            return
          }
        }

        const providerConfig = await promptForProviderConfig(currentDefaultConfig)
        saveProviderConfig(configManager, targetName, providerConfig, { setAsDefault: true })
        console.log(chalk.green(`已保存默认配置 "${targetName}"`))
        console.log(chalk.gray('需要多套配置时，再使用 `mulby ai add [name]` 添加额外 provider。'))
      } catch (error) {
        console.error(chalk.red('配置默认 provider 失败:'), toErrorMessage(error))
      }
    })

  command
    .command('add [name]')
    .description('新增 AI 提供商配置')
    .option('-p, --provider <provider>', '提供商类型')
    .option('-k, --api-key <key>', 'API Key')
    .option('-m, --model <model>', '模型名称')
    .option('-e, --endpoint <url>', 'API 端点')
    .action(async (name: string | undefined, options: AddAiConfigOptions) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const providerConfig = await promptForProviderConfig(undefined, {
          provider: options.provider,
          apiKey: options.apiKey,
          model: options.model,
          endpoint: options.endpoint
        })
        const targetName = suggestProviderName(aiConfig, providerConfig.provider, name)

        if (aiConfig.providers[targetName]) {
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
            type: 'confirm',
            name: 'confirm',
            message: `配置 "${targetName}" 已存在，是否覆盖？`,
            default: false
          }])
          if (!confirm) {
            console.log(chalk.yellow('已取消'))
            return
          }
        }

        const savedConfig = saveProviderConfig(configManager, targetName, providerConfig)
        console.log(chalk.green(`已保存配置 "${targetName}"`))
        if (savedConfig.default === targetName) {
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
          console.log(chalk.gray('使用 `mulby ai setup` 快速配置，或使用 `mulby ai add [name]` 添加配置'))
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
    .command('remove [name]')
    .alias('rm')
    .description('删除指定 AI 配置')
    .action(async (name?: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const targetName = name || resolveDefaultConfigName(aiConfig)
        if (!targetName) {
          console.log(chalk.yellow('请先指定配置名称，或先运行 `mulby ai setup` 创建默认配置'))
          return
        }
        if (!ensureProviderExists(aiConfig, targetName)) {
          return
        }

        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `确定删除配置 "${targetName}" 吗？`,
          default: false
        }])
        if (!confirm) {
          console.log(chalk.yellow('已取消'))
          return
        }

        delete aiConfig.providers[targetName]
        if (aiConfig.default === targetName) {
          aiConfig.default = Object.keys(aiConfig.providers)[0]
        }

        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已删除配置 "${targetName}"`))
        if (aiConfig.default) {
          console.log(chalk.blue(`默认配置已切换为 "${aiConfig.default}"`))
        }
      } catch (error) {
        console.error(chalk.red('删除配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('use [name]')
    .description('设置默认 AI 配置')
    .action((name?: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const targetName = name || resolveDefaultConfigName(aiConfig)
        if (!targetName) {
          console.log(chalk.yellow('请先指定配置名称，或先运行 `mulby ai setup` 创建默认配置'))
          return
        }
        if (!ensureProviderExists(aiConfig, targetName)) {
          return
        }

        aiConfig.default = targetName
        configManager.set('ai', aiConfig)
        console.log(chalk.green(`已将 "${targetName}" 设为默认配置`))
      } catch (error) {
        console.error(chalk.red('设置默认配置失败:'), toErrorMessage(error))
      }
    })

  command
    .command('show [name]')
    .description('查看指定 AI 配置详情')
    .action((name?: string) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const targetName = name || resolveDefaultConfigName(aiConfig)
        if (!targetName) {
          console.log(chalk.yellow('请先指定配置名称，或先运行 `mulby ai setup` 创建默认配置'))
          return
        }

        const config = ensureProviderExists(aiConfig, targetName)
        if (!config) {
          return
        }

        console.log(chalk.bold(`\n配置: ${targetName}`) + (aiConfig.default === targetName ? chalk.gray(' (默认)') : ''))
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
    .command('update [name]')
    .description('更新已有 AI 配置')
    .option('-k, --api-key <key>', '更新 API Key')
    .option('-m, --model <model>', '更新模型')
    .option('-e, --endpoint <url>', '更新 API 端点')
    .action((name: string | undefined, options: UpdateAiConfigOptions) => {
      try {
        const configManager = ConfigManager.getInstance()
        const aiConfig = getAiConfig(configManager)
        const targetName = name || resolveDefaultConfigName(aiConfig)
        if (!targetName) {
          console.log(chalk.yellow('请先指定配置名称，或先运行 `mulby ai setup` 创建默认配置'))
          return
        }

        const config = ensureProviderExists(aiConfig, targetName)
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
        console.log(chalk.green(`已更新配置 "${targetName}"`))
      } catch (error) {
        console.error(chalk.red('更新配置失败:'), toErrorMessage(error))
      }
    })

  return command
}
