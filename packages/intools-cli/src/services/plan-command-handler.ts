import chalk from 'chalk';
import { tui } from './tui';
import { PlanManager } from './plan-manager';
import { TaskPlan, Task, TaskStatus } from '../types/plan';

/**
 * Simplified Plan Command Handler
 *
 * Usage:
 * - /plan          Show current plan status
 * - /plan <需求>    Force plan mode with requirement
 *
 * Everything else is automatic - AI manages the todo list
 */
export class PlanCommandHandler {
    constructor(
        private planManager: PlanManager,
        private getCurrentPlan: () => TaskPlan | null,
        private setCurrentPlan: (plan: TaskPlan | null) => void,
        private savePlan: (plan: TaskPlan) => Promise<void>
    ) {}

    /**
     * Handle /plan command
     * Returns: true if handled, false if should pass to AI
     */
    async handlePlanCommand(args: string[]): Promise<{ handled: boolean; requirement?: string }> {
        const requirement = args.join(' ').trim();

        if (requirement) {
            // /plan <requirement> - Force plan mode, pass to AI
            tui.log(chalk.cyan('📋 进入计划模式...'));
            return { handled: false, requirement };
        }

        // /plan with no args - show current plan
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.gray('当前没有活动的计划。'));
            tui.log(chalk.gray('提示: 输入 /plan <你的需求> 来创建计划'));
            return { handled: true };
        }

        this.displayPlan(plan);
        return { handled: true };
    }

    /**
     * Display plan with progress bar
     */
    displayPlan(plan: TaskPlan): void {
        const summary = this.planManager.getProgressSummary(plan);

        tui.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
        tui.log(chalk.cyan(`📋 ${plan.goal}`));
        tui.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));

        // Progress bar
        const progressBar = this.renderProgressBar(summary.percentage, 30);
        tui.log(`${progressBar} ${summary.completed}/${summary.total} (${Math.round(summary.percentage)}%)`);
        tui.log('');

        // Task list
        for (const task of plan.tasks) {
            const icon = this.getStatusIcon(task.status);
            const color = task.status === 'in_progress' ? chalk.yellow :
                         task.status === 'completed' ? chalk.green :
                         task.status === 'failed' ? chalk.red : chalk.gray;
            tui.log(color(`  ${icon} ${task.title}`));
        }

        tui.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
    }

    /**
     * Display compact progress line (for status updates during execution)
     */
    displayProgress(plan: TaskPlan): void {
        const summary = this.planManager.getProgressSummary(plan);
        const currentTask = plan.tasks.find(t => t.status === 'in_progress');

        const progressBar = this.renderProgressBar(summary.percentage, 15);
        let status = `${progressBar} ${summary.completed}/${summary.total}`;

        if (currentTask) {
            status += chalk.gray(` | ${currentTask.title.slice(0, 30)}`);
        }

        tui.log(chalk.cyan(`📋 ${status}`));
    }

    // --- Methods for AI to call automatically ---

    /**
     * Start a task (mark as in_progress)
     */
    async startTask(taskId: string): Promise<void> {
        const plan = this.getCurrentPlan();
        if (!plan) return;

        const task = plan.tasks.find(t => t.id === taskId);
        if (task && task.status === 'pending') {
            task.status = 'in_progress';
            task.startedAt = new Date();
            plan.status = 'in_progress';
            await this.savePlan(plan);
            this.displayProgress(plan);
        }
    }

    /**
     * Complete a task
     */
    async completeTask(taskId: string): Promise<void> {
        const plan = this.getCurrentPlan();
        if (!plan) return;

        const task = plan.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'completed';
            task.completedAt = new Date();
            await this.savePlan(plan);

            // Check if all tasks completed
            const allDone = plan.tasks.every(t => t.status === 'completed');
            if (allDone) {
                plan.status = 'completed';
                await this.savePlan(plan);
                tui.log(chalk.green('\n🎉 所有任务已完成！'));
                this.displayPlan(plan);
            } else {
                this.displayProgress(plan);
            }
        }
    }

    /**
     * Mark task as failed
     */
    async failTask(taskId: string, error: string): Promise<void> {
        const plan = this.getCurrentPlan();
        if (!plan) return;

        const task = plan.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'failed';
            task.error = error;
            await this.savePlan(plan);
            tui.log(chalk.red(`❌ 任务失败: ${task.title}`));
        }
    }

    /**
     * Get next pending task
     */
    getNextTask(): Task | null {
        const plan = this.getCurrentPlan();
        if (!plan) return null;
        return plan.tasks.find(t => t.status === 'pending') || null;
    }

    /**
     * Get current in-progress task
     */
    getCurrentTask(): Task | null {
        const plan = this.getCurrentPlan();
        if (!plan) return null;
        return plan.tasks.find(t => t.status === 'in_progress') || null;
    }

    // --- Helper methods ---

    private getStatusIcon(status: TaskStatus): string {
        switch (status) {
            case 'completed': return '✅';
            case 'in_progress': return '🔄';
            case 'failed': return '❌';
            case 'skipped': return '⏭️';
            default: return '⏸️';
        }
    }

    private renderProgressBar(percentage: number, width: number): string {
        const filled = Math.round((percentage / 100) * width);
        const empty = width - filled;
        return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    }
}
