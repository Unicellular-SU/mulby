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
import { createReactProject } from '../commands/create/react';

export class AIAgent {
    private aiService = AIServiceFactory.create();
    private sessionManager = SessionManager.getInstance();
    private fileWriter: FileWriter;
    private autoApproveCommands = false;
    private currentProvider?: string;  // 当前使用的供应商名称
    private currentModel?: string;     // 当前使用的模型名称


    constructor(private session: GenerationSession, private systemPrompt?: string) {
        this.fileWriter = new FileWriter(session.targetDir);
    }

    public async start(options: { waitForInput?: boolean } = {}) {
        tui.start();
        tui.log(chalk.blue('🤖 AI Agent 已启动...'));

        // Initialize history if empty
        if (this.session.conversationHistory.length === 0) {
            this.session.conversationHistory.push({
                role: 'system',
                content: this.systemPrompt || SYSTEM_PROMPT
            });
        }

        if (this.session.conversationHistory.length > 0) {
            const count = ContextManager.estimateTokenCount(this.session.conversationHistory);
            // Threshold could be config driven, setting 10k chars (~2.5k tokens) as warning, 
            // but let's say 40k chars (~10k tokens) for auto-compression
            if (count > 10000) {
                tui.log(chalk.yellow(`⚠️ Context is large (~${count} tokens). Auto-compressing to save costs/tokens...`));
                await this.compressContext();
            }
        }

        if (options.waitForInput) {
            await this.handleUserInteraction();
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

                let thinkingBuffer = '';
                let isThinking = false;
                let lastStatusUpdate = 0;

                const response = await this.aiService.chatStream(
                    this.session.conversationHistory,
                    (chunk) => {
                        // Handle thinking tags added by provider
                        if (chunk.includes('<think>')) {
                            isThinking = true;
                            chunk = chunk.replace('<think>', '').trimStart();
                        }

                        if (chunk.includes('</think>')) {
                            isThinking = false;
                            chunk = chunk.replace('</think>', '').trimEnd();
                            tui.setStatus(`Thinking completed. Generating response...`);
                        }

                        if (isThinking && chunk) {
                            thinkingBuffer += chunk;
                            // Update partial thinking status (last 80 chars)
                            // Clean newlines for status bar
                            // Throttle updates to avoid TUI lag (max 10fps) (every 100ms)
                            const now = Date.now();
                            if (now - lastStatusUpdate > 100) {
                                const display = thinkingBuffer.slice(-80).replace(/\n/g, ' ');
                                tui.setStatus(`Thinking: ${display}`);
                                lastStatusUpdate = now;
                            }
                        }
                    },
                    {
                        tools: PLUGIN_GENERATION_TOOLS,
                        toolChoice: 'auto'
                    }
                );
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
                    reasoning_content: response.reasoning_content,
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

                // Check for JSON truncation or parsing errors (likely due to token limit)
                const isJsonError = error.message.includes('JSON') || error.message.includes('Unterminated string');

                if (isJsonError) {
                    tui.log(chalk.yellow('⚠️ 检测到 JSON 解析错误，通常是因为输出被截断 (上下文过长)。'));

                    const shouldRecover = await this.safePromptTui('是否尝试压缩上下文并重试本轮对话？ (Y/n) [默认: Y]');
                    if (shouldRecover.toLowerCase() !== 'n') {
                        // 1. Compress context
                        await this.compressContext();

                        // 2. Remove the last assistant message if it was the one that failed parsing
                        // (If we failed during tool parsing, the assistant message was already added)
                        const lastMsg = this.session.conversationHistory[this.session.conversationHistory.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            this.session.conversationHistory.pop();
                            tui.log(chalk.gray('  Info: Removed partial/failed assistant message from history.'));
                        }

                        this.sessionManager.saveSession(this.session);
                        tui.log(chalk.green('✅ 恢复成功，正在重试...'));
                        continue; // Retry loop
                    }
                }

                // Generic Retry Prompt
                const action = await this.safePromptTui('是否重试？(y/n/exit)');
                if (action.toLowerCase() === 'y') {
                    continue;
                }

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
            case 'scaffold_project':
                return await this.handleScaffoldProject(args.reason);
            case 'finish':
                return await this.handleFinish(args.summary);

            // New Tools
            case 'list_dir':
                return await this.handleListDir(args.path);
            case 'search_files':
                return await this.handleSearchFiles(args.query, args.path);
            case 'read_file_outline':
                return await this.handleReadFileOutline(args.path);
            case 'delete_file':
                return await this.handleDeleteFile(args.path);
            case 'move_file':
                return await this.handleMoveFile(args.source, args.destination);
            case 'fetch_url':
                return await this.handleFetchUrl(args.url);
            case 'check_types':
                return await this.handleCheckTypes();

            // Legacy/Deprecated
            case 'plan_files':
                return "Tool 'plan_files' is deprecated. Please use read_file/write_file directly.";
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    // --- New Tool Handlers ---

    private async handleListDir(dirPath: string): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, dirPath);
        if (!await fs.pathExists(fullPath)) return `Directory not found: ${dirPath}`;

        try {
            const files = await fs.readdir(fullPath);
            const detailed = await Promise.all(files.map(async f => {
                const stat = await fs.stat(path.join(fullPath, f));
                return `${f}${stat.isDirectory() ? '/' : ''}`;
            }));
            return `Contents of ${dirPath}:\n${detailed.join('\n')}`;
        } catch (e: any) {
            return `Error listing directory: ${e.message}`;
        }
    }

    private async handleSearchFiles(query: string, searchPath: string = '.'): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, searchPath);
        if (!await fs.pathExists(fullPath)) return `Path not found: ${searchPath}`;

        const results: string[] = [];
        try {
            // Recursive walk
            const walk = async (dir: string) => {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (['node_modules', '.git', 'dist'].includes(file)) continue;
                    const fPath = path.join(dir, file);
                    const stat = await fs.stat(fPath);
                    if (stat.isDirectory()) {
                        await walk(fPath);
                    } else {
                        const content = await fs.readFile(fPath, 'utf-8');
                        if (content.includes(query)) { // Simple string match, regex support would need eval or new RegExp
                            // If query is regex-like, try regex?
                            // The prompt says "String or Regex". 
                            // Let's safe-guard: if it looks like regex, use regex.
                            // Actually, simple includes is safer for now. 
                            // If user wants regex, we can try new RegExp(query).
                            let match = false;
                            try {
                                if (new RegExp(query).test(content)) match = true;
                            } catch {
                                if (content.includes(query)) match = true;
                            }

                            if (match) {
                                // Find line number
                                const lines = content.split('\n');
                                lines.forEach((line, idx) => {
                                    if (line.includes(query) || (new RegExp(query).test(line))) {
                                        results.push(`${path.relative(this.session.targetDir, fPath)}:${idx + 1}: ${line.trim().slice(0, 100)}`);
                                    }
                                });
                            }
                        }
                    }
                }
            };
            await walk(fullPath);
            return results.length > 0 ? results.join('\n') : 'No matches found.';
        } catch (e: any) {
            return `Error searching files: ${e.message}`;
        }
    }

    private async handleReadFileOutline(filePath: string): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, filePath);
        if (!await fs.pathExists(fullPath)) return `File not found: ${filePath}`;

        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const outline = lines
                .map((line, idx) => ({ line, idx: idx + 1 }))
                .filter(({ line }) => {
                    const l = line.trim();
                    return (
                        l.startsWith('export ') ||
                        l.startsWith('class ') ||
                        l.startsWith('function ') ||
                        l.startsWith('interface ') ||
                        l.startsWith('type ') ||
                        l.match(/^const\s+[A-Z_]+\s+=/) // Constants
                    ) && !l.startsWith('export default'); // Handle default exports maybe?
                })
                .map(({ line, idx }) => `${idx}: ${line.trim()}`);

            return outline.length > 0 ? outline.join('\n') : 'No outline elements found (only imports or internal code?).';
        } catch (e: any) {
            return `Error reading outline: ${e.message}`;
        }
    }

    private async handleDeleteFile(filePath: string): Promise<string> {
        const fullPath = path.resolve(this.session.targetDir, filePath);
        try {
            await fs.remove(fullPath);
            tui.log(chalk.yellow(`  ✓ Deleted ${filePath}`));
            return `Deleted ${filePath}`;
        } catch (e: any) {
            return `Error deleting file: ${e.message}`;
        }
    }

    private async handleMoveFile(source: string, dest: string): Promise<string> {
        const fullSource = path.resolve(this.session.targetDir, source);
        const fullDest = path.resolve(this.session.targetDir, dest);
        try {
            await fs.move(fullSource, fullDest, { overwrite: true });
            tui.log(chalk.yellow(`  ✓ Moved ${source} -> ${dest}`));
            return `Moved ${source} to ${dest}`;
        } catch (e: any) {
            return `Error moving file: ${e.message}`;
        }
    }

    private async handleFetchUrl(url: string): Promise<string> {
        tui.log(chalk.cyan(`  🌐 Fetching ${url}...`));
        try {
            // Using global fetch (Node 18+)
            const response = await fetch(url);
            if (!response.ok) return `Failed to fetch: ${response.status} ${response.statusText}`;
            const text = await response.text();
            // Simple naive HTML to text or just return raw?
            // Use a simple heuristic to strip tags if HTML?
            // For now return raw but truncated
            const maxLength = 20000;
            const content = text.length > maxLength
                ? text.slice(0, maxLength) + `\n...(Truncated ${text.length - maxLength} chars)`
                : text;
            return content;
        } catch (e: any) {
            return `Fetch error: ${e.message}`;
        }
    }

    private async handleCheckTypes(): Promise<string> {
        tui.log(chalk.cyan(`  🛡️ Checking types...`));
        try {
            return await this.handleRunCommand('npm run build'); // Commonly runs tsc
            // Or explicitly: npx tsc --noEmit
        } catch (e: any) {
            return `Type check failed: ${e.message}`;
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

    private async handleScaffoldProject(reason: string): Promise<string> {
        tui.log(chalk.cyan(`📦 正在生成项目脚手架... (${reason})`));

        const targetDir = this.session.targetDir;
        const pluginName = this.session.pluginName || path.basename(targetDir);

        try {
            await createReactProject(targetDir, pluginName);
            tui.log(chalk.green('✓ 脚手架创建完成'));
            return `Project scaffold created successfully at ${targetDir}. The following files were generated:
- package.json
- manifest.json
- vite.config.ts
- tsconfig.json
- src/ui/App.tsx
- src/ui/main.tsx
- src/ui/styles.css
- src/ui/index.html
- src/main.ts

Now you can start implementing the features by modifying these files.`;
        } catch (e: any) {
            return `Failed to create scaffold: ${e.message}`;
        }
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

                // Check if we are exiting while tool calls are pending (e.g. at a prompt inside a tool)
                const last = this.session.conversationHistory[this.session.conversationHistory.length - 1];
                if (last && last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
                    tui.log(chalk.gray('Closing pending tool calls...'));
                    for (const call of last.tool_calls) {
                        this.session.conversationHistory.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name: call.function.name,
                            content: 'Session exited by user.'
                        });
                    }
                }

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

            case '/use':
                // Switch Provider
                if (args.length === 0) {
                    const providers = AIServiceFactory.listProviders();
                    const defaultProvider = AIServiceFactory.getDefaultProvider();
                    const current = this.currentProvider || defaultProvider || providers[0];

                    const items = providers.map(p => ({
                        label: p === current ? `${p} (Current)` : p,
                        value: p
                    }));

                    tui.log(chalk.cyan('Select AI Provider:'));
                    const selected = await tui.select(items);

                    if (selected) {
                        const config = AIServiceFactory.getProviderConfig(selected);
                        if (config) {
                            this.currentProvider = selected;
                            this.currentModel = undefined;
                            this.aiService = AIServiceFactory.create(selected);
                            tui.log(chalk.green(`✓ Switched to "${selected}" (${config.provider})`));
                        }
                    }
                } else {
                    const providerName = args[0];
                    const config = AIServiceFactory.getProviderConfig(providerName);
                    if (!config) {
                        tui.log(chalk.red(`❌ Configuration "${providerName}" not found`));
                    } else {
                        this.currentProvider = providerName;
                        this.currentModel = undefined;
                        this.aiService = AIServiceFactory.create(providerName);
                        tui.log(chalk.green(`✓ Switched to "${providerName}" (${config.provider})`));
                    }
                }
                return true;

            case '/model':
                // Switch Model
                if (args.length === 0) {
                    const providers = AIServiceFactory.listProviders();
                    const defaultProvider = AIServiceFactory.getDefaultProvider();
                    const currentProviderName = this.currentProvider || defaultProvider || providers[0];
                    const config = AIServiceFactory.getProviderConfig(currentProviderName);

                    if (config) {
                        const currentModel = this.currentModel || config.model || 'Default';

                        // Import PROVIDER_MODELS
                        const { PROVIDER_MODELS } = await import('../types/ai');
                        const availableModels = PROVIDER_MODELS[config.provider];

                        if (availableModels && availableModels.length > 0) {
                            const items = availableModels.map(m => ({
                                label: m === currentModel ? `${m} (Current)` : m,
                                value: m
                            }));

                            tui.log(chalk.cyan(`Select Model for ${currentProviderName}:`));
                            const selected = await tui.select(items);

                            if (selected) {
                                this.currentModel = selected;
                                this.aiService = AIServiceFactory.create(currentProviderName, selected);
                                tui.log(chalk.green(`✓ Switched model to "${selected}"`));
                            }
                        } else {
                            tui.log(chalk.yellow(`No models predefined for provider type: ${config.provider}`));
                        }
                    }
                } else {
                    const modelName = args.join(' ');
                    const providers = AIServiceFactory.listProviders();
                    const defaultProvider = AIServiceFactory.getDefaultProvider();
                    const currentProviderName = this.currentProvider || defaultProvider || providers[0];

                    this.currentModel = modelName;
                    this.aiService = AIServiceFactory.create(currentProviderName, modelName);
                    tui.log(chalk.green(`✓ Switched model to "${modelName}"`));
                }
                return true;

            case '/help':
                tui.log(chalk.green(`
Available Commands:
  /exit, /quit   - Save and exit
  /clear         - Clear conversation history (keeps system prompt)
  /tokens        - Show estimated token usage
  /compress      - Summarize and compress history manually
  /use [name]    - Switch AI provider (show list if no name)
  /model [name]  - Switch model (show list if no name)
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

        tui.log(chalk.gray('(输入新需求继续，或输入 /exit 退出)'));
        const input = await this.safePromptTui('请输入修改需求:');

        // Since we are strictly "continuing" if the user gave input (otherwise /exit would happen in safePromptTui),
        // we essentially treat this as a user feedback loop.
        return `User provided new requirement after previous completion: ${input}`;
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
