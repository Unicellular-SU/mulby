
import chalk from 'chalk';
import inquirer from 'inquirer';
import { SessionManager } from '../services/session-manager';
import { AIAgent } from '../services/ai-generator';
import { tui } from '../services/tui';

export async function resume(options: any) {
    const sessionManager = SessionManager.getInstance();
    const cwd = process.cwd();

    console.log(chalk.gray(`Checking for sessions in ${cwd}...`));

    const session = sessionManager.getLatestSessionForDir(cwd);

    if (!session) {
        console.log(chalk.yellow('No active AI session found for this directory.'));
        console.log('You can start a new one with: mulby create <name> --ai');
        return;
    }

    console.log(chalk.green(`Found session: ${session.id}`));
    console.log(chalk.blue(`Description: ${session.description}`));
    console.log(chalk.gray(`Status: ${session.status}`));

    // Check for interrupted tool execution (dangling tool calls)
    // Check for interrupted tool execution (dangling tool calls)
    // Find the last assistant message
    let lastAssistantIdx = -1;
    for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
        if (session.conversationHistory[i].role === 'assistant') {
            lastAssistantIdx = i;
            break;
        }
    }

    if (lastAssistantIdx !== -1) {
        const lastAsstMsg = session.conversationHistory[lastAssistantIdx];
        if (lastAsstMsg.tool_calls && lastAsstMsg.tool_calls.length > 0) {
            console.log(chalk.cyan(`Debug: Checking tool chain integrity for Assistant Msg #${lastAssistantIdx}...`));

            // 1. Identify valid tool responses that exist *anywhere* after the assistant
            // logic: we want to keep valid tool responses but remove 'user' junk in between
            const subsequentMessages = session.conversationHistory.slice(lastAssistantIdx + 1);
            const validToolResponses = subsequentMessages.filter(m =>
                m.role === 'tool' &&
                lastAsstMsg.tool_calls!.some(c => c.id === m.tool_call_id)
            );

            // 2. Check if we need to repair (if there are intervening junk OR missing calls)
            // If subsequentMessages has more items than validToolResponses, there is junk.
            // If validToolResponses.length < tool_calls.length, there are missing calls.

            const hasJunk = subsequentMessages.length > validToolResponses.length;
            const hasMissingKeys = validToolResponses.length < lastAsstMsg.tool_calls.length;

            if (hasJunk || hasMissingKeys) {
                console.log(chalk.yellow(`⚠️ Detected broken tool chain (Junk: ${hasJunk}, Missing: ${hasMissingKeys}). Repairing...`));

                // 3. Rebuild history
                // Keep everything up to Assistant
                const newHistory = session.conversationHistory.slice(0, lastAssistantIdx + 1);

                // Add valid existing responses
                // We map tool_calls to preserve order or just push what we found?
                // OpenAI prefers order matching tool_calls usually, but ID matching is key.
                // Let's iterate tool_calls and find response or create fake.

                for (const call of lastAsstMsg.tool_calls) {
                    const existing = validToolResponses.find(m => m.tool_call_id === call.id);
                    if (existing) {
                        newHistory.push(existing);
                    } else {
                        newHistory.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name: call.function.name,
                            content: 'Session resumed. Tool execution interrupted or failed to save.'
                        });
                    }
                }

                // Update session
                session.conversationHistory = newHistory;
                sessionManager.saveSession(session);
                console.log(chalk.green('✓ History repaired. Removed intervening user messages and filled missing tool outputs.'));
            }
        }
    }

    // If session is completed or failed, we might want to check if user wants to continue
    if (session.status === 'completed' || session.status === 'failed') {
        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Session is marked as ${session.status}. Do you want to continue working on it?`,
            default: true
        }]);

        if (!confirm) {
            return;
        }

        session.status = 'generating';
        sessionManager.saveSession(session);
    }

    // Start UI
    // Note: AIAgent will look for system prompt in history or default.
    // Since we are resuming, we assume the agent can handle context.
    const agent = new AIAgent(session);
    await agent.start({ waitForInput: true });
}
