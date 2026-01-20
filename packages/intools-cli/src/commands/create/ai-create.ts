
import chalk from 'chalk';
import inquirer from 'inquirer';
import { SessionManager } from '../../services/session-manager';
import { AIAgent } from '../../services/ai-generator';
import { ConfigManager } from '../../services/config-manager';
import { buildSystemPrompt, USER_GUIDE_PROMPT } from '../../services/ai/prompts';
import * as path from 'path';
import { FileWriter } from '../../services/file-writer';
import { createReactProject } from './react';

export async function aiCreate(name: string, options: any) {
    const configManager = ConfigManager.getInstance();
    const sessionManager = SessionManager.getInstance();

    // 1. Check Config
    const apiKey = configManager.get('ai.apiKey');
    if (!apiKey) {
        console.log(chalk.yellow('⚠️  未检测到 AI 配置'));
        const { configure } = await inquirer.prompt([{
            type: 'confirm',
            name: 'configure',
            message: '是否立即配置 AI 服务商？',
            default: true
        }]);

        if (!configure) {
            console.log('已取消。请先配置: intools config set ai.apiKey <key>');
            return;
        }

        // Simple config flow
        const answers = await inquirer.prompt([
            {
                type: 'list',
                name: 'provider',
                message: '选择服务商:',
                choices: ['openai', 'claude', 'deepseek', 'custom'], // Added claude/deepseek
                default: 'openai'
            },
            {
                type: 'input',
                name: 'apiKey',
                message: 'API Key:',
                validate: (input) => input.length > 0
            },
            {
                type: 'input',
                name: 'apiEndpoint',
                message: 'API Endpoint (Optional):',
                when: (answers) => answers.provider === 'custom'
            }
        ]);

        configManager.set('ai.provider', answers.provider);
        configManager.set('ai.apiKey', answers.apiKey);
        if (answers.apiEndpoint) {
            configManager.set('ai.apiEndpoint', answers.apiEndpoint);
        }
        console.log(chalk.green('✓ 配置已保存'));
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

    // 3. New Session
    console.log(USER_GUIDE_PROMPT);

    const { description } = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: '功能描述:',
        validate: (input) => input.length > 5
    }]);

    const targetDir = path.resolve(process.cwd(), name);

    const session = sessionManager.createSession(description, targetDir);
    session.pluginName = name;

    // Add user message to history
    session.conversationHistory.push({
        role: 'user',
        content: `我的插件名称是 "${name}"。\n需求描述：${description}`
    });
    sessionManager.saveSession(session);

    // Scaffold Project
    console.log(chalk.cyan('📦 正在生成项目脚手架...'));
    await createReactProject(targetDir, name);

    console.log(chalk.green('✓ 脚手架创建完成'));

    // Start AI Agent
    const systemPrompt = buildSystemPrompt({}, true); // true indicates project is scaffolded
    const agent = new AIAgent(session, systemPrompt);
    await agent.start();
}
