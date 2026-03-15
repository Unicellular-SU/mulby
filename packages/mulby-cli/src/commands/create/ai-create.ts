import chalk from 'chalk'
import inquirer from 'inquirer'
import * as path from 'path'
import { SessionManager } from '../../services/session-manager'
import { AIAgent } from '../../services/ai-generator'
import { ConfigManager } from '../../services/config-manager'
import { promptForProviderConfig, saveProviderConfig } from '../../services/ai-config'
import { buildSystemPrompt } from '../../services/ai/prompts'
import { createReactProject } from './react'
import { type AIConfig } from '../../types/ai'

interface AiCreateOptions {
  resume?: string | boolean
  desc?: string
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
      console.log('已取消。请先运行 mulby ai setup 完成配置。')
      return
    }

    const providerConfig = await promptForProviderConfig()
    saveProviderConfig(configManager, 'default', providerConfig, { setAsDefault: true })
    console.log(chalk.green('默认 AI 配置已保存'))
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
    console.error(chalk.red('脚手架创建失败:'), error)
    return
  }

  const session = sessionManager.createSession(`插件: ${name}`, targetDir)
  session.pluginName = name

  let initialPrompt = `我想创建一个名为 "${name}" 的 Mulby 插件。`
  initialPrompt += '\n\n项目脚手架已经创建完成（React + Vite + Mulby API）。'
  initialPrompt += '\n请默认使用内置的 develop-mulby-plugin skill 作为主工作流。'
  initialPrompt += '\n1. 先读 @skills/develop-mulby-plugin/SKILL.md，再检查 manifest.json、src/main.ts、src/ui/App.tsx。'
  initialPrompt += '\n2. 通过提问与我确认插件目标、features/cmds、UI/Main/Preload 分工、是否需要 Node.js 或 Electron bridging。'
  initialPrompt += '\n3. 编码前先给出一份“接入契约”摘要，说明 manifest 计划、featureCode 映射、文件修改范围和后续验证步骤。'
  initialPrompt += '\n4. 先实现一个能在 Mulby 里跑通的最小闭环，再扩展功能和 UI。'
  initialPrompt += '\n5. 如果涉及图标定稿，请在功能和主题稳定后再读 @skills/generate-electron-icons/SKILL.md，并用它的脚本生成最终 icon.png。'
  initialPrompt += '\n6. 完成前必须运行 validate_plugin，确认通过后再收尾。'
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
