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
import { ContextManager } from './ai/context-manager';
import { tui } from './tui';

export class AIAgent {
    private aiService = AIServiceFactory.create();
    private sessionManager = SessionManager.getInstance();
    private fileWriter: FileWriter;
    private autoApproveCommands = false;


    constructor(private session: GenerationSession, private systemPrompt?: string) {
        this.fileWriter = new FileWriter(session.targetDir);
    }

    public async start() {
        tui.start();
        tui.log(chalk.blue('🤖 AI Agent 已启动...'));

        // Initialize history if empty
        if (this.session.conversationHistory.length === 0) {
            this.session.conversationHistory.push({
                role: 'system',
                content: this.systemPrompt || SYSTEM_PROMPT
            });
        }

        // Check/Add context if just starting (simple check if user message is the last one)
        // Or we can rely on the user guide prompt input in cli command.

        if (this.session.conversationHistory.length > 0) {
            const count = ContextManager.estimateTokenCount(this.session.conversationHistory);
            // Threshold could be config driven, setting 10k chars (~2.5k tokens) as warning, 
            // but let's say 40k chars (~10k tokens) for auto-compression
            if (count > 10000) {
                tui.log(chalk.yellow(`⚠️ Context is large (~${count} tokens). Auto-compressing to save costs/tokens...`));
                await this.compressContext();
            }
        }

        await this.runLoop();
    }

    private async runLoop() {
        let loopCount = 0;
        const MAX_LOOPS = 50;

        while (this.session.status !== 'completed' && this.session.status !== 'failed' && loopCount < MAX_LOOPS) {
            loopCount++;

            try {
                // 0. Update Dynamic File Map (The Head)
                // We update the System Prompt (the first message) with the current file structure
                // This ensures the AI always has the latest "World View".
                if (this.session.conversationHistory.length > 0 && this.session.conversationHistory[0].role === 'system') {
                    const currentFileMap = await this.generateFileMap();
                    // We need to re-build the system prompt with the new map
                    // Since we stored the initial systemPrompt in constructor, we can rebuild it.
                    // But wait, constructure systemPrompt might be the *result* string.
                    // Actually, prompts.ts exports `buildSystemPrompt`.
                    // We should probably just replace the "## Current Project Structure" section if we want to be fancy,
                    // or easier: just rebuild the whole string using `buildSystemPrompt`.
                    // However, we don't have the original `templates` here easily unless we stored them.
                    // Plan B: Just Append/Replace the file map at the end of the system prompt if it exists, or rely on a marker.

                    // Better approach: Let's import buildSystemPrompt and use it.
                    // But we don't have `templates` or `isScaffolded` state stored in AIAgent.
                    // Let's modify AIAgent to store the original config or just hack it:
                    // We will inject a specific marker in the prompts.ts and regex replace it here.
                    // Or simpler: Just rebuild it if we can. 

                    // Actually, let's keep it simple. We will update the system prompt by replacing the 
                    // content inside ```...``` of the "Current Project Structure" section if it exists,
                    // or append it if it doesn't.

                    let sysContent = this.session.conversationHistory[0].content || '';
                    const mapHeader = '## Current Project Structure';

                    if (sysContent.includes(mapHeader)) {
                        // Replace existing map
                        // Regex to match: ## Current Project Structure\n(Auto-updated file tree)\n```\n[\s\S]*?\n```
                        sysContent = sysContent.replace(
                            /## Current Project Structure\n\(Auto-updated file tree\)\n```[\s\S]*?```/,
                            `## Current Project Structure\n(Auto-updated file tree)\n\`\`\`\n${currentFileMap}\n\`\`\``
                        );
                    } else {
                        // Append new map (first run or migration)
                        sysContent += `\n\n## Current Project Structure\n(Auto-updated file tree)\n\`\`\`\n${currentFileMap}\n\`\`\``;
                    }

                    this.session.conversationHistory[0].content = sysContent;
                }

                tui.setStatus(`Thinking... (Turn ${loopCount})`);
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
                // process.stdout.write(`\r\x1b[K`); // Clear line
                tui.log(chalk.gray(`Thinking... (Turn ${loopCount}) - ${duration}s${usageInfo}`));

                // 2. Add Assistant Message
                const assistantMsg: AIMessage = {
                    role: 'assistant',
                    content: response.content,
                    tool_calls: response.toolCalls
                };
                this.session.conversationHistory.push(assistantMsg);
                this.sessionManager.saveSession(this.session);

                if (response.content) {
                    tui.log(chalk.white('AI: ' + response.content));
                }

                // 3. Handle Tool Calls
                if (response.toolCalls && response.toolCalls.length > 0) {
                    for (const toolCall of response.toolCalls) {
                        const toolName = toolCall.function.name;
                        const toolArgs = JSON.parse(toolCall.function.arguments);
                        const toolCallId = toolCall.id;

                        tui.log(chalk.cyan(`[Tool] Calling ${toolName}...`));

                        let result: string;
                        try {
                            tui.setStatus(`Executing ${toolName}...`);
                            result = await this.executeTool(toolName, toolArgs);
                        } catch (e: any) {
                            result = `Error executing tool ${toolName}: ${e.message}`;
                            tui.log(chalk.red(`[Tool Error] ${result}`));
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
                tui.log(chalk.red('\n❌ Agent 发生错误: ' + error.message));
                this.session.status = 'failed';
                this.session.error = error.message;
                this.sessionManager.saveSession(this.session);
                tui.stop();
                return;
            }
        }
        tui.stop();
    }

    private async executeTool(name: string, args: any): Promise<string> {
        switch (name) {
            case 'read_file':
                return await this.handleReadFile(args.path);
            case 'replace_in_file':
                return await this.handleReplaceInFile(args.path, args.target, args.replacement);
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
            case 'finish':
                return await this.handleFinish(args.summary);
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
        tui.log(chalk.green(`  ✓ Wrote ${filePath}`));
        return `Successfully wrote file: ${filePath}`;
    }

    private async handleReplaceInFile(filePath: string, target: string, replacement: string): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, filePath);

        if (!await fs.pathExists(fullPath)) {
            return `File not found: ${filePath}`;
        }

        const content = await fs.readFile(fullPath, 'utf-8');

        if (!content.includes(target)) {
            // Check for potential whitespace/formatting issues causing mismatch
            // For now, strict match failure
            return `Error: Target string not found in file. Please ensure 'target' matches exactly (including indentation). You might want to use read_file first to verify constraint.`;
        }

        const parts = content.split(target);
        if (parts.length > 2) {
            return `Error: Target string found multiple times (${parts.length - 1} times). Please provide a more unique target string context to ensure correct replacement.`;
        }

        const newContent = content.replace(target, replacement);
        await this.fileWriter.writeFile(filePath, newContent);
        tui.log(chalk.green(`  ✓ Modified ${filePath}`));

        return `Successfully replaced content in ${filePath}.`;
    }

    private async handleRunCommand(command: string): Promise<string> {
        // Security check? whitelist?
        // simple whitelist for now
        const allowed = ['npm install', 'npm i', 'yarn add', 'pnpm add', 'mkdir', 'touch'];
        const isAllowed = allowed.some(p => command.startsWith(p));

        if (!isAllowed && !this.autoApproveCommands) {
            const confirm = await this.safePromptTui(`AI wants to run command: "${command}". Allow? (y/n/a[lways])`);
            const lower = confirm.toLowerCase();
            if (lower === 'a' || lower === 'always') {
                this.autoApproveCommands = true;
            } else if (lower !== 'y') {
                return "User denied command execution.";
            }
        }

        tui.log(chalk.yellow(`  > Executing: ${command}`));

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

    // ... (previous methods)

    // Centralized handler for user input to intercept Slash Commands
    private async promptUser(message: string): Promise<string | null> {
        tui.setStatus('Waiting for user input...');
        const prefix = chalk.blue('›');
        // Use TUI prompt
        const input = await tui.prompt(`${prefix} ${message}`);

        if (input.startsWith('/')) {
            const handled = await this.handleSlashCommand(input);
            if (handled) {
                // If command handled (e.g. /tokens), we prompt again effectively (or return null to loop)
                // For simplified flow, we return null to indicate "no input for AI yet, handled by system"
                return null;
            }
            // If /exit, handleSlashCommand handles process exit or session ending
        }
        return input;
    }

    private async handleSlashCommand(command: string): Promise<boolean> {
        const [cmd, ...args] = command.split(' ');

        switch (cmd) {
            case '/exit':
            case '/quit':
                tui.log(chalk.yellow('👋 Exiting session...'));
                this.session.status = 'completed'; // or keep as is?
                this.sessionManager.saveSession(this.session);
                tui.stop();
                process.exit(0);
                return true;

            case '/clear':
                tui.log(chalk.yellow('🧹 Clearing context (keeping system prompt)...'));
                const systemPrompt = this.session.conversationHistory.find(m => m.role === 'system');
                this.session.conversationHistory = systemPrompt ? [systemPrompt] : [];
                this.sessionManager.saveSession(this.session);
                return true;

            case '/tokens':
                const count = ContextManager.estimateTokenCount(this.session.conversationHistory);
                tui.log(chalk.cyan(`📊 Current Context: ~${count} tokens (${this.session.conversationHistory.length} messages)`));
                return true;

            case '/compress':
                tui.log(chalk.yellow('📦 Compressing context...'));
                await this.compressContext();
                return true;

            case '/help':
                tui.log(chalk.green(`
Available Commands:
  /exit, /quit   - Save and exit
  /clear         - Clear conversation history (keeps system prompt)
  /tokens        - Show estimated token usage
  /compress      - Summarize and compress history manually
  /help          - Show this help
`));
                return true;

            default:
                tui.log(chalk.red(`Unknown command: ${cmd}`));
                return true;
        }
    }

    private async compressContext() {
        // Use a lightweight summarizer (or just the same AI service)
        const summarizer = async (text: string) => {
            // Create a temporary simplified chat for summarization
            const result = await this.aiService.chat([
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: `Please summarize the following technical conversation history into a concise paragraph, capturing key decisions and current state:\n\n${text}` }
            ], { toolChoice: 'none' }); // No tools for summary
            return result.content || 'No summary generated.';
        };

        this.session.conversationHistory = await ContextManager.compressHistory(
            this.session.conversationHistory,
            6, // Keep last 6 messages
            summarizer
        );
        this.sessionManager.saveSession(this.session);
        tui.log(chalk.green('✅ Context compressed.'));
    }

    private async handleAskUser(question: string): Promise<string> {
        tui.log(chalk.magenta(`\n🤖 AI Question: ${question}`));

        while (true) {
            const answer = await this.promptUser('Your Answer:');
            if (answer !== null) return answer;
            // If answer is null, it meant a slash command was executed, so we loop again to ask for input.
        }
    }

    private async handleUserInteraction() {
        while (true) {
            const input = await this.promptUser('用户输入 (或直接回车继续):');
            if (input === null) continue; // Slash command executed

            if (input && input.trim()) {
                this.session.conversationHistory.push({
                    role: 'user',
                    content: input
                });
                this.sessionManager.saveSession(this.session);
                break; // Break loop to let AI process content
            } else {
                // Empty input (Enter)
                break;
            }
        }
    }

    // Helper to allow slash commands during any prompt
    private async safePromptTui(message: string): Promise<string> {
        while (true) {
            const input = await tui.prompt(message);
            if (input.startsWith('/')) {
                const handled = await this.handleSlashCommand(input);
                if (handled) continue; // Loop back to prompt if handled (unless exit killed process)
            }
            return input;
        }
    }

    // ... (rest of the class)

    private async handleFinish(summary: string): Promise<string> {
        tui.log(chalk.green('\n✅ AI 认为任务已完成:'));
        tui.log(chalk.white(summary));

        const action = await this.safePromptTui('下一步操作? (exit/continue)');

        if (action === 'exit') {
            this.session.status = 'completed';
            return "Task marked as completed.";
        } else {
            const input = await this.safePromptTui('请输入修改需求:');
            return `User rejected completion. New requirement: ${input}`;
        }
    }
    /**
     * Generates a simplified file tree for the context.
     * Ignores node_modules, .git, dist, etc.
     */
    private async generateFileMap(): Promise<string> {
        const rootDir = this.session.targetDir;
        let fileMap = '';

        const walk = async (currentDir: string, indent: string) => {
            try {
                const files = await fs.readdir(currentDir);
                // Sort: directories first, then files
                files.sort((a, b) => {
                    return a.localeCompare(b);
                });

                for (const file of files) {
                    if (['node_modules', '.git', 'dist', '.DS_Store', 'package-lock.json', 'yarn.lock'].includes(file)) continue;

                    const fullPath = path.join(currentDir, file);
                    const stats = await fs.stat(fullPath);

                    if (stats.isDirectory()) {
                        fileMap += `${indent}${file}/\n`;
                        await walk(fullPath, indent + '  ');
                    } else {
                        fileMap += `${indent}${file}\n`;
                    }
                }
            } catch (e) {
                fileMap += `${indent}(Error reading directory)\n`;
            }
        };

        if (await fs.pathExists(rootDir)) {
            await walk(rootDir, '');
        } else {
            fileMap = '(Target directory not created yet)';
        }

        return fileMap.trim();
    }
}
