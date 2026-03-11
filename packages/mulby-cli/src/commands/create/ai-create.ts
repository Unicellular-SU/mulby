import chalk from 'chalk'
import inquirer from 'inquirer'
import * as path from 'path'
import { SessionManager } from '../../services/session-manager'
import { AIAgent } from '../../services/ai-generator'
import { ConfigManager } from '../../services/config-manager'
import { buildSystemPrompt } from '../../services/ai/prompts'
import { createReactProject } from './react'
import { type AIConfig, type AIProviderType, PROVIDER_MODELS } from '../../types/ai'

interface AiCreateOptions {
  resume?: string | boolean
  desc?: string
}

interface BootstrapAnswers {
  configName: string
  provider: AIProviderType
  apiKey: string
  model?: string
  apiEndpoint?: string
}

export async function aiCreate(name: string, options: AiCreateOptions) {
  const configManager = ConfigManager.getInstance()
  const sessionManager = SessionManager.getInstance()

  const aiConfig = configManager.get<AIConfig>('ai')
  if (!aiConfig || !aiConfig.providers || Object.keys(aiConfig.providers).length === 0) {
    console.log(chalk.yellow('未检测到 AI 配置'))
    const { configure } = await inquirer.prompt<{ configure: boolean }>([{
      type: 'confirm',
      name: 'configure',
      message: '是否立即配置 AI 服务商？',
      default: true
    }])

    if (!configure) {
      console.log('已取消。请先运行 mulby ai add <name> 完成配置。')
      return
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'configName',
        message: '配置名称（例如: my-openai）:',
        default: 'default',
        validate: (input: string) => input.length > 0
      },
      {
        type: 'list',
        name: 'provider',
        message: '选择服务商',
        choices: [
          { name: 'OpenAI', value: 'openai' },
          { name: 'Claude (Anthropic)', value: 'claude' },
          { name: 'DeepSeek', value: 'deepseek' },
          { name: 'Gemini (Google)', value: 'gemini' },
          { name: 'GLM', value: 'glm' },
          { name: 'Custom', value: 'custom' }
        ],
        default: 'openai'
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'API Key:',
        validate: (input: string) => input.length > 0
      },
      {
        type: 'list',
        name: 'model',
        message: '选择模型',
        choices: (answers: BootstrapAnswers) => PROVIDER_MODELS[answers.provider] || [],
        when: (answers: BootstrapAnswers) => (PROVIDER_MODELS[answers.provider] || []).length > 0
      },
      {
        type: 'input',
        name: 'apiEndpoint',
        message: 'API Endpoint:',
        when: (answers: BootstrapAnswers) => answers.provider === 'custom',
        validate: (input: string) => input.length > 0
      }
    ] as never) as BootstrapAnswers

    configManager.set('ai', {
      default: answers.configName,
      providers: {
        [answers.configName]: {
          provider: answers.provider,
          apiKey: answers.apiKey,
          model: answers.model,
          apiEndpoint: answers.apiEndpoint
        }
      }
    } satisfies AIConfig)

    console.log(chalk.green(`配置 "${answers.configName}" 已保存`))
  }

  if (options.resume) {
    const session = typeof options.resume === 'string'
      ? sessionManager.getSession(options.resume)
      : sessionManager.getRecentSession()

    if (!session) {
      console.log(chalk.red('未找到可恢复的会话'))
      return
    }

    console.log(chalk.blue(`恢复会话: ${session.id} (${session.description})`))
    if (session.status === 'completed' || session.status === 'failed') {
      console.log(chalk.yellow('重新激活已结束的会话...'))
      session.status = 'generating'
      sessionManager.saveSession(session)
    }

    const agent = new AIAgent(session)
    await agent.start({ waitForInput: true })
    return
  }

  const targetDir = path.resolve(process.cwd(), name)
  console.log(chalk.blue(`\n初始化项目脚手架: ${name}...`))
  try {
    await createReactProject(targetDir, name)
    console.log(chalk.green('脚手架创建完成\n'))
  } catch (error) {
    console.error(chalk.red('脚手架创建失败'), error)
    return
  }

  const session = sessionManager.createSession(`插件: ${name}`, targetDir)
  session.pluginName = name

  let initialPrompt = `我想创建一个名为 "${name}" 的 Mulby 插件。`
  initialPrompt += '\n\n项目脚手架已经创建完成（React 18 + Tailwind CSS v3 + Vite + Mulby API）。'
  initialPrompt += '\n当前文件结构已包含 manifest.json、src/ui/App.tsx、src/main.ts 等基础文件。'
  initialPrompt += '\n请先读取现有文件结构，再作为产品顾问通过提问帮助我明确功能需求和 UI 设计。'
  if (options.desc) {
    initialPrompt += `\n\n插件初步设想: ${options.desc}\n`
  }

  session.conversationHistory.push({
    role: 'user',
    content: initialPrompt
  })
  sessionManager.saveSession(session)

  const systemPrompt = buildSystemPrompt({}, true)
  const agent = new AIAgent(session, systemPrompt)
  await agent.start()
}
