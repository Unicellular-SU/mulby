
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
        console.log('You can start a new one with: intools create <name> --ai');
        return;
    }

    console.log(chalk.green(`Found session: ${session.id}`));
    console.log(chalk.blue(`Description: ${session.description}`));
    console.log(chalk.gray(`Status: ${session.status}`));

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

        // Ask for new instruction since it was done
        const { newInstruction } = await inquirer.prompt([{
            type: 'input',
            name: 'newInstruction',
            message: 'Enter new instruction (or press Enter to let AI decide):'
        }]);

        if (newInstruction && newInstruction.trim()) {
            session.conversationHistory.push({
                role: 'user',
                content: newInstruction
            });
            sessionManager.saveSession(session);
        }
    }

    // Start UI
    // Note: AIAgent will look for system prompt in history or default.
    // Since we are resuming, we assume the agent can handle context.
    const agent = new AIAgent(session);
    await agent.start();
}
