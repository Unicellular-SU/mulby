
import chalk from 'chalk';
import inquirer from 'inquirer';
import { SessionManager } from '../../services/session-manager';
import { AIAgent } from '../../services/ai-generator';
import { ConfigManager } from '../../services/config-manager';
import { buildSystemPrompt, USER_GUIDE_PROMPT } from '../../services/ai/prompts';
import * as path from 'path';
import { FileWriter } from '../../services/file-writer';
import { createReactProject } from './react';
import { AIConfig, AIProviderType, PROVIDER_MODELS } from '../../types/ai';

export async function aiCreate(name: string, options: any) {
    const configManager = ConfigManager.getInstance();
    const sessionManager = SessionManager.getInstance();

    // 1. Check Config
    const aiConfig = configManager.get<AIConfig>('ai');
    if (!aiConfig || !aiConfig.providers || Object.keys(aiConfig.providers).length === 0) {
        console.log(chalk.yellow('⚠️  未检测到 AI 配置'));
        const { configure } = await inquirer.prompt([{
            type: 'confirm',
            name: 'configure',
            message: '是否立即配置 AI 服务商？',
            default: true
        }]);

        if (!configure) {
            console.log('已取消。请先配置: mulby ai add <name>');
            return;
        }

        // Simple config flow
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'configName',
                message: '配置名称 (例如: my-openai):',
                default: 'default',
                validate: (input) => input.length > 0
            },
            {
                type: 'list',
                name: 'provider',
                message: '选择服务商:',
                choices: [
                    { name: 'OpenAI', value: 'openai' },
                    { name: 'Claude (Anthropic)', value: 'claude' },
                    { name: 'DeepSeek', value: 'deepseek' },
                    { name: 'Gemini (Google)', value: 'gemini' },
                    { name: 'GLM (智谱AI)', value: 'glm' },
                    { name: 'Custom (自定义)', value: 'custom' }
                ],
                default: 'openai'
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'API Key:',
                validate: (input) => input.length > 0
            },
            {
                type: 'list',
                name: 'model',
                message: '选择模型:',
                choices: (answers: any) => PROVIDER_MODELS[answers.provider as AIProviderType],
                when: (answers: any) => PROVIDER_MODELS[answers.provider as AIProviderType]?.length > 0
            },
            {
                type: 'input',
                name: 'apiEndpoint',
                message: 'API Endpoint:',
                when: (answers) => answers.provider === 'custom',
                validate: (input) => input.length > 0
            }
        ]);

        const newConfig: AIConfig = {
            default: answers.configName,
            providers: {
                [answers.configName]: {
                    provider: answers.provider,
                    apiKey: answers.apiKey,
                    model: answers.model,
                    apiEndpoint: answers.apiEndpoint
                }
            }
        };

        configManager.set('ai', newConfig);
        console.log(chalk.green(`✓ 配置 "${answers.configName}" 已保存`));
    }

    // 2. Handle Resume or New Session
    if (options.resume) {
        // Resume logic
        let session;
        if (typeof options.resume === 'string') {
            session = sessionManager.getSession(options.resume);
        } else {
            session = sessionManager.getRecentSession();
        }

        if (!session) {
            console.log(chalk.red('未找到可恢复的会话'));
            return;
        }

        console.log(chalk.blue(`恢复会话: ${session.id} (${session.description})`));
        // Use default system prompt for resumed sessions or try to rebuild it?
        // Ideally prompt is already in history, but we might want to update it if we have new templates.
        // For simplicity, we assume history has the prompt.

        if (session.status === 'completed' || session.status === 'failed') {
            console.log(chalk.yellow('🔄 Reactivating completed/failed session...'));
            session.status = 'generating';
            sessionManager.saveSession(session);
        }

        const agent = new AIAgent(session);
        await agent.start({ waitForInput: true });
        return;
    }

    // 3. New Session - 先进入顾问模式，收集需求后再创建脚手架
    // 3. New Session - 先创建脚手架，再进入顾问模式
    const targetDir = path.resolve(process.cwd(), name);

    console.log(chalk.blue(`\n🚀 初始化项目脚手架: ${name}...`));
    try {
        await createReactProject(targetDir, name);
        console.log(chalk.green('✓ 脚手架创建完成\n'));
    } catch (err) {
        console.error(chalk.red('脚手架创建失败:'), err);
        return;
    }

    const session = sessionManager.createSession(`插件: ${name}`, targetDir);
    session.pluginName = name;

    // 初始消息：告知 AI 脚手架已就绪，触发 Consultant Mode (Context Aware)
    let initialPrompt = `我想创建一个名为 "${name}" 的 Mulby 插件。`;
    initialPrompt += `\n\n✅ 项目脚手架已创建完成 (React 18 + Tailwind CSS v3 + Vite + Mulby API)。`;
    initialPrompt += `\n当前文件结构已包含：manifest.json, src/ui/App.tsx, src/main.ts 等基础文件。`;
    initialPrompt += `\n请读取现有文件了解结构，并作为产品顾问并通过提问帮我明确功能需求和 UI 设计。`;

    if (options.desc) {
        initialPrompt += `\n\n插件初步设想: ${options.desc}\n`;
    }

    session.conversationHistory.push({
        role: 'user',
        content: initialPrompt
    });
    sessionManager.saveSession(session);

    // isScaffolded = true，让 AI 知道项目已存在，可以读取文件
    // 此时 user 还没有确认具体需求，所以 AI 仍需进入 Phase 1，但在有上下文的情况下进行
    const systemPrompt = buildSystemPrompt({}, true);
    const agent = new AIAgent(session, systemPrompt);
    await agent.start();
}
