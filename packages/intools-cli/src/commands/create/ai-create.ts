
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
            console.log('已取消。请先配置: intools ai add <name>');
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

            // Prompt for new instructions since the last task was finished
            const { newInstruction } = await inquirer.prompt([{
                type: 'input',
                name: 'newInstruction',
                message: '请输入新的修改需求 (直接回车则由 AI 决定下一步):'
            }]);

            if (newInstruction && newInstruction.trim()) {
                session.conversationHistory.push({
                    role: 'user',
                    content: newInstruction
                });
                sessionManager.saveSession(session);
            }
        }

        const agent = new AIAgent(session);
        await agent.start();
        return;
    }

    // 3. New Session - 先进入顾问模式，收集需求后再创建脚手架
    const targetDir = path.resolve(process.cwd(), name);

    const session = sessionManager.createSession(`插件: ${name}`, targetDir);
    session.pluginName = name;

    // 初始消息：传递插件名称和描述(如果有)，触发 AI 进入顾问模式
    let initialPrompt = `我想创建一个名为 "${name}" 的 InTools 插件。`;

    // InTools 简介背景，帮助 AI 建立上下文
    initialPrompt += `\n\n【关于 InTools】\nInTools 是一款跨平台桌面效率工具箱 (类似 uTools/Raycast)。插件支持 React UI + Node.js 后端，可访问系统 API (剪贴板、模拟输入、文件读写等)。`;

    if (options.desc) {
        initialPrompt += `\n\n插件描述: ${options.desc}\n`;
    }
    initialPrompt += `\n请进入产品顾问模式，通过提问帮我明确需求。`;

    session.conversationHistory.push({
        role: 'user',
        content: initialPrompt
    });
    sessionManager.saveSession(session);

    // 先启动 AI Agent 进行需求收集（此时尚未创建脚手架）
    // isScaffolded = false，让 AI 知道项目尚未创建
    const systemPrompt = buildSystemPrompt({}, false);
    const agent = new AIAgent(session, systemPrompt);
    await agent.start();
}
