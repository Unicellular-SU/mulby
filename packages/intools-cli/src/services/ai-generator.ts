import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import { AIServiceFactory } from './ai';
import { SessionManager, GenerationSession } from './session-manager';
import { FileWriter } from './file-writer';
import { SYSTEM_PROMPT } from './ai/prompts';
import { PLUGIN_GENERATION_TOOLS } from './ai/tools';
import { AIMessage } from '../types/ai';

export class AIAgent {
    private aiService = AIServiceFactory.create();
    private sessionManager = SessionManager.getInstance();
    private fileWriter: FileWriter;

    constructor(private session: GenerationSession, private systemPrompt?: string) {
        this.fileWriter = new FileWriter(session.targetDir);
    }

    public async start() {
        console.log(chalk.blue('🤖 AI Agent 已启动...'));

        // Initialize history if empty
        if (this.session.conversationHistory.length === 0) {
            this.session.conversationHistory.push({
                role: 'system',
                content: this.systemPrompt || SYSTEM_PROMPT
            });
        }

        // Check/Add context if just starting (simple check if user message is the last one)
        // Or we can rely on the user guide prompt input in cli command.

        await this.runLoop();
    }

    private async runLoop() {
        let loopCount = 0;
        const MAX_LOOPS = 50;

        while (this.session.status !== 'completed' && this.session.status !== 'failed' && loopCount < MAX_LOOPS) {
            loopCount++;

            try {
                process.stdout.write(chalk.gray(`Thinking... (Turn ${loopCount})`)); // Show initial status without newline
                const startTime = Date.now();
                const response = await this.aiService.chat(this.session.conversationHistory, {
                    tools: PLUGIN_GENERATION_TOOLS,
                    toolChoice: 'auto' // Let AI decide
                });
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                let usageInfo = '';
                if (response.usage) {
                    usageInfo = `, ${response.usage.totalTokens} tokens`;
                }

                // Clear previous "Thinking..." line and print stats
                process.stdout.write(`\r\x1b[K`); // Clear line
                console.log(chalk.gray(`Thinking... (Turn ${loopCount}) - ${duration}s${usageInfo}`));

                // 2. Add Assistant Message
                const assistantMsg: AIMessage = {
                    role: 'assistant',
                    content: response.content,
                    tool_calls: response.toolCalls
                };
                this.session.conversationHistory.push(assistantMsg);
                this.sessionManager.saveSession(this.session);

                if (response.content) {
                    console.log(chalk.white('AI: ' + response.content));
                }

                // 3. Handle Tool Calls
                if (response.toolCalls && response.toolCalls.length > 0) {
                    for (const toolCall of response.toolCalls) {
                        const toolName = toolCall.function.name;
                        const toolArgs = JSON.parse(toolCall.function.arguments);
                        const toolCallId = toolCall.id;

                        console.log(chalk.cyan(`[Tool] Calling ${toolName}...`));

                        let result: string;
                        try {
                            result = await this.executeTool(toolName, toolArgs);
                        } catch (e: any) {
                            result = `Error executing tool ${toolName}: ${e.message}`;
                            console.error(chalk.red(`[Tool Error] ${result}`));
                        }

                        // Add Tool Result Message
                        this.session.conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            name: toolName,
                            content: result
                        });
                        this.sessionManager.saveSession(this.session);
                    }
                } else {
                    // No tools called. Check if it looks like a question to user or just chatter.
                    // If just chatter, maybe we continue? or wait for user?
                    // Usually if no tools, it's just talking. We might want to pause for user input?
                    // For now, if no tools are called, we assume it's waiting for user input or just speaking.
                    // But in non-interactive CLI loop, we need to prompt user if AI stops acting.
                    // However, we added 'ask_user' tool. The AI *should* use it.
                    // If it doesn't use 'ask_user' but stops, we'll prompt user regardless.

                    await this.handleUserInteraction();
                }

            } catch (error: any) {
                console.error(chalk.red('\n❌ Agent 发生错误:'), error.message);
                this.session.status = 'failed';
                this.session.error = error.message;
                this.sessionManager.saveSession(this.session);
                return;
            }
        }
    }

    private async executeTool(name: string, args: any): Promise<string> {
        switch (name) {
            case 'read_file':
                return await this.handleReadFile(args.path);
            case 'write_file':
                return await this.handleWriteFile(args.path, args.content);
            case 'run_command':
                return await this.handleRunCommand(args.command);
            case 'ask_user':
                return await this.handleAskUser(args.question);
            case 'finish':
                return await this.handleFinish(args.summary);
            // Legacy/Deprecated
            case 'plan_files':
                return "Tool 'plan_files' is deprecated. Please use read_file/write_file directly.";
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private async handleReadFile(filePath: string): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, filePath);
        if (!await fs.pathExists(fullPath)) {
            return `File not found: ${filePath}`;
        }
        return await fs.readFile(fullPath, 'utf-8');
    }

    private async handleWriteFile(filePath: string, content: string): Promise<string> {
        await this.fileWriter.writeFile(filePath, content);
        console.log(chalk.green(`  ✓ Wrote ${filePath}`));
        return `Successfully wrote file: ${filePath}`;
    }

    private async handleRunCommand(command: string): Promise<string> {
        // Security check? whitelist?
        // simple whitelist for now
        const allowed = ['npm install', 'npm i', 'yarn add', 'pnpm add', 'mkdir', 'touch'];
        const isAllowed = allowed.some(p => command.startsWith(p));

        if (!isAllowed) {
            const { confirm } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirm',
                message: `AI wants to run command: "${command}". Allow?`,
                default: false
            }]);
            if (!confirm) return "User denied command execution.";
        }

        console.log(chalk.yellow(`  > Executing: ${command}`));

        return new Promise((resolve, reject) => {
            const child = spawn(command, {
                cwd: this.session.targetDir,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (d) => stdout += d.toString());
            child.stderr.on('data', (d) => stderr += d.toString());

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(`Command executed successfully.\nOutput: ${stdout}`);
                } else {
                    resolve(`Command failed with code ${code}.\nStderr: ${stderr}\nStdout: ${stdout}`);
                }
            });
            child.on('error', (err) => resolve(`Command execution error: ${err.message}`));
        });
    }

    private async handleAskUser(question: string): Promise<string> {
        console.log(chalk.magenta(`\n🤖 AI Question: ${question}`));
        const { answer } = await inquirer.prompt([{
            type: 'input',
            name: 'answer',
            message: 'Your Answer:'
        }]);
        return answer;
    }

    private async handleFinish(summary: string): Promise<string> {
        console.log(chalk.green('\n✅ AI 认为任务已完成:'));
        console.log(chalk.white(summary));

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: '下一步操作?',
            choices: [
                { name: '结束会话 (Exit)', value: 'exit' },
                { name: '继续提问 (Continue)', value: 'continue' }
            ]
        }]);

        if (action === 'exit') {
            this.session.status = 'completed';
            return "Task marked as completed.";
        } else {
            const { input } = await inquirer.prompt([{
                type: 'input',
                name: 'input',
                message: '请输入修改需求:'
            }]);
            return `User rejected completion. New requirement: ${input}`;
        }
    }

    // Fallback if AI talks without using tools (e.g. asking for clarification freely)
    private async handleUserInteraction() {
        const { input } = await inquirer.prompt([{
            type: 'input',
            name: 'input',
            message: '用户输入 (或直接回车继续):'
        }]);

        if (input && input.trim()) {
            this.session.conversationHistory.push({
                role: 'user',
                content: input
            });
            this.sessionManager.saveSession(this.session);
        }
    }
}
