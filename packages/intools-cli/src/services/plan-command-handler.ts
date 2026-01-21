import chalk from 'chalk';
import { PlanManager } from './plan-manager';
import { TaskPlan, Task, TaskStatus, PlanTemplate } from '../types/plan';
import { DependencyManager } from './dependency-manager';
import { PlanAdapter } from './plan-adapter';
import { tui } from './tui';

/**
 * Command handler for plan-related slash commands
 * Implements Phase 2 & 3: Interactive Enhancement + Advanced Features
 */
export class PlanCommandHandler {
    private dependencyManager = new DependencyManager();
    private planAdapter = new PlanAdapter();

    constructor(
        private planManager: PlanManager,
        private getCurrentPlan: () => TaskPlan | null,
        private setCurrentPlan: (plan: TaskPlan | null) => void,
        private savePlan: (plan: TaskPlan) => Promise<void>
    ) {}

    /**
     * Handle /plan commands
     */
    async handlePlanCommand(args: string[]): Promise<boolean> {
        const subCmd = args[0] || 'show';

        switch (subCmd) {
            case 'show':
                return this.showPlan();
            case 'edit':
                return this.editPlan();
            case 'clear':
                return this.clearPlan();
            case 'resume':
                return this.resumePlan();
            case 'approve':
                return this.approvePlan();
            case 'save':
                return this.saveAsTemplate(args[1]);
            case 'load':
                return this.loadFromTemplate(args[1]);
            case 'deps':
                return this.showDependencies();
            case 'validate':
                return this.validatePlan();
            default:
                tui.log(chalk.red(`Unknown /plan subcommand: ${subCmd}`));
                this.showPlanHelp();
                return true;
        }
    }

    /**
     * Handle /template commands
     */
    async handleTemplateCommand(args: string[]): Promise<boolean> {
        const subCmd = args[0] || 'list';

        switch (subCmd) {
            case 'list':
                return this.listTemplates();
            case 'use':
                return this.useTemplate(args[1]);
            case 'delete':
                return this.deleteTemplate(args[1]);
            case 'builtin':
                return this.showBuiltInTemplates();
            default:
                tui.log(chalk.red(`Unknown /template subcommand: ${subCmd}`));
                this.showTemplateHelp();
                return true;
        }
    }

    /**
     * Handle /progress commands
     */
    async handleProgressCommand(args: string[]): Promise<boolean> {
        const subCmd = args[0] || '';

        switch (subCmd) {
            case 'detail':
                return this.showDetailedProgress();
            case 'export':
                return this.exportProgress(args[1]);
            case 'json':
                return this.exportProgressJson();
            default:
                return this.showProgress();
        }
    }

    /**
     * Handle /task commands
     */
    async handleTaskCommand(args: string[]): Promise<boolean> {
        const subCmd = args[0] || '';

        switch (subCmd) {
            case 'next':
                return this.showNextTask();
            case 'skip':
                return this.skipTask(args[1]);
            case 'retry':
                return this.retryTask(args[1]);
            case 'add':
                return this.addTask();
            case 'remove':
                return this.removeTask(args[1]);
            case 'detail':
                return this.showTaskDetail(args[1]);
            default:
                tui.log(chalk.red(`Unknown /task subcommand: ${subCmd}`));
                this.showTaskHelp();
                return true;
        }
    }

    // --- /plan subcommands ---

    private showPlan(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan. Use AI to create one or /plan resume to load an existing plan.'));
            return true;
        }

        this.renderPlanOverview(plan);
        return true;
    }

    private async editPlan(): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to edit.'));
            return true;
        }

        tui.log(chalk.cyan('\n📋 Current Plan:'));
        this.renderTaskList(plan);

        tui.log(chalk.cyan('\nSelect action:'));
        const action = await tui.select([
            { label: 'Add task', value: 'add' },
            { label: 'Remove task', value: 'remove' },
            { label: 'Modify task', value: 'modify' },
            { label: 'Reorder tasks', value: 'reorder' },
            { label: 'Cancel', value: 'cancel' }
        ]);

        if (!action || action === 'cancel') {
            return true;
        }

        switch (action) {
            case 'add':
                await this.addTask();
                break;
            case 'remove':
                await this.interactiveRemoveTask(plan);
                break;
            case 'modify':
                await this.interactiveModifyTask(plan);
                break;
            case 'reorder':
                tui.log(chalk.yellow('Reorder functionality coming soon.'));
                break;
        }

        return true;
    }

    private async clearPlan(): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to clear.'));
            return true;
        }

        const confirm = await tui.prompt('Are you sure you want to clear the current plan? (y/n)');
        if (confirm.toLowerCase() === 'y') {
            this.setCurrentPlan(null);
            tui.log(chalk.green('Plan cleared.'));
        }

        return true;
    }

    private async resumePlan(): Promise<boolean> {
        const plans = await this.planManager.listPlans();

        if (plans.length === 0) {
            tui.log(chalk.yellow('No saved plans found.'));
            return true;
        }

        tui.log(chalk.cyan('\n📋 Saved Plans:'));
        const items = plans.slice(0, 10).map(p => ({
            label: `${p.goal} (${p.status}) - ${p.tasks.filter(t => t.status === 'completed').length}/${p.tasks.length}`,
            value: p.id
        }));

        const selected = await tui.select(items);
        if (selected) {
            const plan = await this.planManager.loadPlan(selected);
            if (plan) {
                this.setCurrentPlan(plan);
                tui.log(chalk.green(`Loaded plan: ${plan.goal}`));
                this.renderPlanOverview(plan);
            }
        }

        return true;
    }

    private async approvePlan(): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to approve.'));
            return true;
        }

        if (plan.status !== 'draft') {
            tui.log(chalk.yellow(`Plan is already ${plan.status}.`));
            return true;
        }

        plan.status = 'approved';
        plan.updatedAt = new Date();
        await this.savePlan(plan);
        tui.log(chalk.green('Plan approved! Ready to execute.'));

        return true;
    }

    // --- /progress subcommands ---

    private showProgress(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        const summary = this.planManager.getProgressSummary(plan);

        tui.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        tui.log(chalk.cyan(`📋 ${plan.goal}`));
        tui.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

        // Progress bar
        const barWidth = 20;
        const filled = Math.round((summary.percentage / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);

        tui.log(chalk.white(`\nProgress: [${bar}] ${Math.round(summary.percentage)}%`));
        tui.log(chalk.gray(`Completed: ${summary.completed}/${summary.total}`));

        if (summary.inProgress > 0) {
            tui.log(chalk.blue(`In Progress: ${summary.inProgress}`));
        }
        if (summary.failed > 0) {
            tui.log(chalk.red(`Failed: ${summary.failed}`));
        }
        if (summary.skipped > 0) {
            tui.log(chalk.gray(`Skipped: ${summary.skipped}`));
        }

        // Show current task
        const currentTask = plan.tasks.find(t => t.status === 'in_progress');
        if (currentTask) {
            tui.log(chalk.cyan(`\n🔄 Current: ${currentTask.title}`));
        }

        // Show next task
        const nextTask = this.planManager.getNextTask(plan);
        if (nextTask && nextTask.id !== currentTask?.id) {
            tui.log(chalk.gray(`⏭️  Next: ${nextTask.title}`));
        }

        tui.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

        return true;
    }

    private showDetailedProgress(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        tui.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        tui.log(chalk.cyan(`📋 Task Plan: ${plan.goal}`));
        tui.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

        for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i];
            const icon = this.getStatusIcon(task.status);
            const color = this.getStatusColor(task.status);

            tui.log(chalk[color](`\n${icon} ${i + 1}. ${task.title}`));
            tui.log(chalk.gray(`    ${task.description}`));

            if (task.acceptanceCriteria.length > 0) {
                tui.log(chalk.gray('    Acceptance Criteria:'));
                task.acceptanceCriteria.forEach(c => {
                    tui.log(chalk.gray(`      • ${c}`));
                });
            }

            if (task.files.length > 0) {
                tui.log(chalk.gray(`    Files: ${task.files.join(', ')}`));
            }

            if (task.dependencies.length > 0) {
                tui.log(chalk.gray(`    Dependencies: ${task.dependencies.join(', ')}`));
            }

            if (task.error) {
                tui.log(chalk.red(`    Error: ${task.error}`));
            }

            if (task.startedAt) {
                tui.log(chalk.gray(`    Started: ${task.startedAt.toLocaleTimeString()}`));
            }
            if (task.completedAt) {
                tui.log(chalk.gray(`    Completed: ${task.completedAt.toLocaleTimeString()}`));
            }
        }

        tui.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        tui.log(chalk.gray(`Status: ${plan.status} | Updated: ${plan.updatedAt.toLocaleString()}`));

        return true;
    }

    private async exportProgress(format?: string): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to export.'));
            return true;
        }

        if (format === 'json') {
            return this.exportProgressJson();
        }

        const summary = this.planManager.getProgressSummary(plan);
        const report = this.generateMarkdownReport(plan, summary);

        tui.log(chalk.cyan('\n--- Progress Report (Markdown) ---\n'));
        tui.log(report);
        tui.log(chalk.cyan('\n--- End of Report ---'));

        return true;
    }

    private exportProgressJson(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to export.'));
            return true;
        }

        const report = this.generateJsonReport(plan);

        tui.log(chalk.cyan('\n--- Progress Report (JSON) ---\n'));
        tui.log(report);
        tui.log(chalk.cyan('\n--- End of Report ---'));

        return true;
    }

    // --- /task subcommands ---

    private showNextTask(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        const nextTask = this.planManager.getNextTask(plan);
        if (!nextTask) {
            tui.log(chalk.green('All tasks completed or blocked!'));
            return true;
        }

        tui.log(chalk.cyan('\n⏭️  Next Task:'));
        this.renderTaskDetail(nextTask, plan.tasks.indexOf(nextTask) + 1);

        return true;
    }

    private async skipTask(taskId?: string): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        let task: Task | undefined;

        if (taskId) {
            task = plan.tasks.find(t => t.id === taskId);
        } else {
            // Skip current in-progress task or next pending task
            task = plan.tasks.find(t => t.status === 'in_progress') ||
                   this.planManager.getNextTask(plan) || undefined;
        }

        if (!task) {
            tui.log(chalk.yellow('No task to skip.'));
            return true;
        }

        const confirm = await tui.prompt(`Skip task "${task.title}"? (y/n)`);
        if (confirm.toLowerCase() === 'y') {
            this.planManager.updateTaskStatus(plan, task.id, 'skipped');
            await this.savePlan(plan);
            tui.log(chalk.yellow(`Skipped: ${task.title}`));
        }

        return true;
    }

    private async retryTask(taskId?: string): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        let task: Task | undefined;

        if (taskId) {
            task = plan.tasks.find(t => t.id === taskId);
        } else {
            // Find first failed task
            task = plan.tasks.find(t => t.status === 'failed');
        }

        if (!task) {
            tui.log(chalk.yellow('No failed task to retry.'));
            return true;
        }

        if (task.status !== 'failed') {
            tui.log(chalk.yellow(`Task "${task.title}" is not in failed state.`));
            return true;
        }

        this.planManager.updateTaskStatus(plan, task.id, 'pending');
        task.error = undefined;
        task.startedAt = undefined;
        task.completedAt = undefined;
        await this.savePlan(plan);
        tui.log(chalk.green(`Task "${task.title}" reset to pending.`));

        return true;
    }

    private async addTask(): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        const title = await tui.prompt('Task title:');
        if (!title.trim()) {
            tui.log(chalk.yellow('Cancelled.'));
            return true;
        }

        const description = await tui.prompt('Task description (optional):');

        const newTask: Omit<Task, 'id' | 'createdAt'> = {
            title: title.trim(),
            description: description.trim() || title.trim(),
            status: 'pending',
            priority: 'medium',
            dependencies: [],
            acceptanceCriteria: [],
            files: []
        };

        this.planManager.addTask(plan, newTask);
        await this.savePlan(plan);
        tui.log(chalk.green(`Added task: ${title}`));

        return true;
    }

    private async removeTask(taskId?: string): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        if (taskId) {
            try {
                this.planManager.removeTask(plan, taskId);
                await this.savePlan(plan);
                tui.log(chalk.green(`Removed task: ${taskId}`));
            } catch (e: any) {
                tui.log(chalk.red(`Error: ${e.message}`));
            }
        } else {
            await this.interactiveRemoveTask(plan);
        }

        return true;
    }

    private showTaskDetail(taskId?: string): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        let task: Task | undefined;

        if (taskId) {
            task = plan.tasks.find(t => t.id === taskId);
        } else {
            // Show current task
            task = plan.tasks.find(t => t.status === 'in_progress');
        }

        if (!task) {
            tui.log(chalk.yellow('Task not found.'));
            return true;
        }

        const index = plan.tasks.indexOf(task) + 1;
        this.renderTaskDetail(task, index);

        return true;
    }

    // --- Interactive helpers ---

    private async interactiveRemoveTask(plan: TaskPlan): Promise<void> {
        const pendingTasks = plan.tasks.filter(t => t.status === 'pending');
        if (pendingTasks.length === 0) {
            tui.log(chalk.yellow('No pending tasks to remove.'));
            return;
        }

        const items = pendingTasks.map((t, i) => ({
            label: `${t.id}: ${t.title}`,
            value: t.id
        }));

        const selected = await tui.select(items);
        if (selected) {
            try {
                this.planManager.removeTask(plan, selected);
                await this.savePlan(plan);
                tui.log(chalk.green(`Removed task: ${selected}`));
            } catch (e: any) {
                tui.log(chalk.red(`Error: ${e.message}`));
            }
        }
    }

    private async interactiveModifyTask(plan: TaskPlan): Promise<void> {
        const items = plan.tasks.map((t, i) => ({
            label: `${i + 1}. ${t.title} (${t.status})`,
            value: t.id
        }));

        const selected = await tui.select(items);
        if (!selected) return;

        const task = plan.tasks.find(t => t.id === selected);
        if (!task) return;

        tui.log(chalk.cyan(`\nModifying: ${task.title}`));

        const field = await tui.select([
            { label: 'Title', value: 'title' },
            { label: 'Description', value: 'description' },
            { label: 'Priority', value: 'priority' },
            { label: 'Cancel', value: 'cancel' }
        ]);

        if (!field || field === 'cancel') return;

        switch (field) {
            case 'title':
                const newTitle = await tui.prompt(`New title (current: ${task.title}):`);
                if (newTitle.trim()) {
                    task.title = newTitle.trim();
                }
                break;
            case 'description':
                const newDesc = await tui.prompt(`New description:`);
                if (newDesc.trim()) {
                    task.description = newDesc.trim();
                }
                break;
            case 'priority':
                const priority = await tui.select([
                    { label: 'High', value: 'high' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'Low', value: 'low' }
                ]);
                if (priority) {
                    task.priority = priority as Task['priority'];
                }
                break;
        }

        plan.updatedAt = new Date();
        await this.savePlan(plan);
        tui.log(chalk.green('Task updated.'));
    }

    // --- Rendering helpers ---

    private renderPlanOverview(plan: TaskPlan): void {
        const summary = this.planManager.getProgressSummary(plan);

        tui.log(chalk.cyan('\n┌────────────────────────────────────────────────────────┐'));
        tui.log(chalk.cyan(`│ 📋 ${plan.goal.slice(0, 50).padEnd(52)} │`));
        tui.log(chalk.cyan('├────────────────────────────────────────────────────────┤'));

        for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i];
            const icon = this.getStatusIcon(task.status);
            const suffix = task.status === 'in_progress' ? ' (current)' : '';
            const line = `${icon} ${i + 1}. ${task.title}${suffix}`;
            tui.log(chalk.white(`│ ${line.slice(0, 54).padEnd(54)} │`));
        }

        tui.log(chalk.cyan('├────────────────────────────────────────────────────────┤'));
        tui.log(chalk.gray(`│ Progress: ${summary.completed}/${summary.total} (${Math.round(summary.percentage)}%) | Status: ${plan.status.padEnd(16)} │`));
        tui.log(chalk.cyan('└────────────────────────────────────────────────────────┘'));
    }

    private renderTaskList(plan: TaskPlan): void {
        for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i];
            const icon = this.getStatusIcon(task.status);
            tui.log(chalk.white(`  ${icon} ${i + 1}. ${task.title}`));
        }
    }

    private renderTaskDetail(task: Task, index: number): void {
        const icon = this.getStatusIcon(task.status);
        const color = this.getStatusColor(task.status);

        tui.log(chalk[color](`\n${icon} Task ${index}: ${task.title}`));
        tui.log(chalk.gray(`   Description: ${task.description}`));
        tui.log(chalk.gray(`   Priority: ${task.priority}`));
        tui.log(chalk.gray(`   Status: ${task.status}`));

        if (task.acceptanceCriteria.length > 0) {
            tui.log(chalk.gray('   Acceptance Criteria:'));
            task.acceptanceCriteria.forEach(c => {
                tui.log(chalk.gray(`     • ${c}`));
            });
        }

        if (task.files.length > 0) {
            tui.log(chalk.gray(`   Files: ${task.files.join(', ')}`));
        }

        if (task.dependencies.length > 0) {
            tui.log(chalk.gray(`   Dependencies: ${task.dependencies.join(', ')}`));
        }

        if (task.error) {
            tui.log(chalk.red(`   Error: ${task.error}`));
        }
    }

    private getStatusIcon(status: TaskStatus): string {
        switch (status) {
            case 'completed': return '✅';
            case 'in_progress': return '🔄';
            case 'pending': return '⏸️ ';
            case 'failed': return '❌';
            case 'skipped': return '⏭️ ';
            default: return '  ';
        }
    }

    private getStatusColor(status: TaskStatus): 'green' | 'blue' | 'gray' | 'red' | 'yellow' {
        switch (status) {
            case 'completed': return 'green';
            case 'in_progress': return 'blue';
            case 'pending': return 'gray';
            case 'failed': return 'red';
            case 'skipped': return 'yellow';
            default: return 'gray';
        }
    }

    private generateMarkdownReport(plan: TaskPlan, summary: ReturnType<typeof this.planManager.getProgressSummary>): string {
        const lines: string[] = [];

        lines.push(`# Progress Report: ${plan.goal}`);
        lines.push('');
        lines.push(`**Status:** ${plan.status}`);
        lines.push(`**Progress:** ${summary.completed}/${summary.total} (${Math.round(summary.percentage)}%)`);
        lines.push(`**Updated:** ${plan.updatedAt.toLocaleString()}`);
        lines.push('');
        lines.push('## Tasks');
        lines.push('');

        for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i];
            const icon = this.getStatusIcon(task.status);
            lines.push(`${i + 1}. ${icon} **${task.title}** - ${task.status}`);
            if (task.description !== task.title) {
                lines.push(`   - ${task.description}`);
            }
            if (task.error) {
                lines.push(`   - Error: ${task.error}`);
            }
        }

        lines.push('');
        lines.push('## Summary');
        lines.push('');
        lines.push(`- Completed: ${summary.completed}`);
        lines.push(`- In Progress: ${summary.inProgress}`);
        lines.push(`- Pending: ${summary.pending}`);
        lines.push(`- Failed: ${summary.failed}`);
        lines.push(`- Skipped: ${summary.skipped}`);

        return lines.join('\n');
    }

    // --- Help messages ---

    private showPlanHelp(): void {
        tui.log(chalk.cyan(`
/plan Commands:
  /plan show       - Show current plan
  /plan edit       - Edit plan interactively
  /plan clear      - Clear current plan
  /plan resume     - Resume a saved plan
  /plan approve    - Approve draft plan for execution
  /plan save [n]   - Save plan as template
  /plan load [n]   - Load plan from template
  /plan deps       - Show dependency tree
  /plan validate   - Validate plan dependencies
`));
    }

    private showTaskHelp(): void {
        tui.log(chalk.cyan(`
/task Commands:
  /task next         - Show next task
  /task skip [id]    - Skip a task
  /task retry [id]   - Retry a failed task
  /task add          - Add a new task
  /task remove [id]  - Remove a task
  /task detail [id]  - Show task details
`));
    }

    private showTemplateHelp(): void {
        tui.log(chalk.cyan(`
/template Commands:
  /template list     - List all templates
  /template use [n]  - Create plan from template
  /template delete   - Delete a template
  /template builtin  - Show built-in templates
`));
    }

    // --- Template methods ---

    private async saveAsTemplate(name?: string): Promise<boolean> {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan to save as template.'));
            return true;
        }

        let templateName = name;
        if (!templateName) {
            templateName = await tui.prompt('Template name:');
            if (!templateName.trim()) {
                tui.log(chalk.yellow('Cancelled.'));
                return true;
            }
        }

        // Sanitize name
        templateName = templateName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');

        await this.planManager.saveTemplate(plan, templateName);
        tui.log(chalk.green(`Saved template: ${templateName}`));

        return true;
    }

    private async loadFromTemplate(name?: string): Promise<boolean> {
        let templateName = name;

        if (!templateName) {
            // Show list of templates to choose from
            const templates = await this.planManager.listTemplates();
            const builtIn = this.planManager.getBuiltInTemplates();
            const allTemplates = [...builtIn, ...templates];

            if (allTemplates.length === 0) {
                tui.log(chalk.yellow('No templates available.'));
                return true;
            }

            const items = allTemplates.map(t => ({
                label: `${t.name} - ${t.description}`,
                value: t.name
            }));

            templateName = await tui.select(items);
            if (!templateName) return true;
        }

        // Check if it's a built-in template first
        const builtIn = this.planManager.getBuiltInTemplates().find(t => t.name === templateName);
        let plan: TaskPlan | null;

        if (builtIn) {
            // Create plan from built-in template
            plan = this.planManager.createPlan(
                builtIn.description,
                builtIn.tasks.map(t => ({ ...t, status: 'pending' as const }))
            );
        } else {
            plan = await this.planManager.loadTemplate(templateName);
        }

        if (!plan) {
            tui.log(chalk.red(`Template not found: ${templateName}`));
            return true;
        }

        // Ask for custom goal
        const customGoal = await tui.prompt(`Goal (default: ${plan.goal}):`);
        if (customGoal.trim()) {
            plan.goal = customGoal.trim();
        }

        this.setCurrentPlan(plan);
        await this.savePlan(plan);
        tui.log(chalk.green(`Created plan from template: ${templateName}`));
        this.renderPlanOverview(plan);

        return true;
    }

    private async listTemplates(): Promise<boolean> {
        const templates = await this.planManager.listTemplates();
        const builtIn = this.planManager.getBuiltInTemplates();

        tui.log(chalk.cyan('\n📋 Available Templates\n'));

        if (builtIn.length > 0) {
            tui.log(chalk.yellow('Built-in Templates:'));
            builtIn.forEach(t => {
                tui.log(chalk.white(`  • ${t.name} - ${t.description}`));
                if (t.tags.length > 0) {
                    tui.log(chalk.gray(`    Tags: ${t.tags.join(', ')}`));
                }
            });
        }

        if (templates.length > 0) {
            tui.log(chalk.yellow('\nCustom Templates:'));
            templates.forEach(t => {
                tui.log(chalk.white(`  • ${t.name} - ${t.description}`));
                if (t.tags.length > 0) {
                    tui.log(chalk.gray(`    Tags: ${t.tags.join(', ')}`));
                }
            });
        }

        if (templates.length === 0 && builtIn.length === 0) {
            tui.log(chalk.gray('No templates available.'));
        }

        tui.log('');
        return true;
    }

    private async useTemplate(name?: string): Promise<boolean> {
        return this.loadFromTemplate(name);
    }

    private async deleteTemplate(name?: string): Promise<boolean> {
        let templateName = name;

        if (!templateName) {
            const templates = await this.planManager.listTemplates();
            if (templates.length === 0) {
                tui.log(chalk.yellow('No custom templates to delete.'));
                return true;
            }

            const items = templates.map(t => ({
                label: `${t.name} - ${t.description}`,
                value: t.name
            }));

            templateName = await tui.select(items);
            if (!templateName) return true;
        }

        const confirm = await tui.prompt(`Delete template "${templateName}"? (y/n)`);
        if (confirm.toLowerCase() === 'y') {
            const deleted = await this.planManager.deleteTemplate(templateName);
            if (deleted) {
                tui.log(chalk.green(`Deleted template: ${templateName}`));
            } else {
                tui.log(chalk.red(`Template not found: ${templateName}`));
            }
        }

        return true;
    }

    private showBuiltInTemplates(): boolean {
        const templates = this.planManager.getBuiltInTemplates();

        tui.log(chalk.cyan('\n📋 Built-in Templates\n'));

        templates.forEach(t => {
            tui.log(chalk.yellow(`\n${t.name.toUpperCase()}: ${t.description}`));
            tui.log(chalk.gray(`Tags: ${t.tags.join(', ')}`));
            tui.log(chalk.white('Tasks:'));
            t.tasks.forEach((task, i) => {
                tui.log(chalk.white(`  ${i + 1}. ${task.title}`));
                tui.log(chalk.gray(`     ${task.description}`));
            });
        });

        tui.log('');
        return true;
    }

    // --- Dependency methods ---

    private showDependencies(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        tui.log(chalk.cyan('\n📊 Dependency Analysis\n'));

        // Show dependency tree
        const tree = this.dependencyManager.visualizeDependencies(plan.tasks);
        tui.log(tree);

        // Show critical path
        const criticalPath = this.dependencyManager.getCriticalPath(plan.tasks);
        if (criticalPath.length > 0) {
            tui.log(chalk.yellow('\n🎯 Critical Path:'));
            tui.log(chalk.white(`   ${criticalPath.map(t => t.title).join(' → ')}`));
            tui.log(chalk.gray(`   (${criticalPath.length} tasks)`));
        }

        // Show work estimate
        const estimate = this.planAdapter.estimateRemainingWork(plan);
        tui.log(chalk.yellow('\n📈 Work Estimate:'));
        tui.log(chalk.white(`   Pending tasks: ${estimate.pendingTaskCount}`));
        tui.log(chalk.white(`   By priority: High=${estimate.byPriority.high}, Medium=${estimate.byPriority.medium}, Low=${estimate.byPriority.low}`));
        tui.log(chalk.white(`   Blocked tasks: ${estimate.blockedTasks}`));
        if (estimate.estimatedTimeMs > 0) {
            tui.log(chalk.white(`   Estimated time: ${estimate.estimatedTimeFormatted}`));
        }

        tui.log('');
        return true;
    }

    private validatePlan(): boolean {
        const plan = this.getCurrentPlan();
        if (!plan) {
            tui.log(chalk.yellow('No active plan.'));
            return true;
        }

        tui.log(chalk.cyan('\n🔍 Validating Plan...\n'));

        const validation = this.dependencyManager.validateDependencies(plan.tasks);

        if (validation.valid) {
            tui.log(chalk.green('✅ Plan is valid!'));

            // Show additional info
            const sorted = this.dependencyManager.topologicalSort(plan.tasks);
            if (sorted) {
                tui.log(chalk.gray(`   Execution order: ${sorted.join(' → ')}`));
            }
        } else {
            tui.log(chalk.red('❌ Plan has issues:'));
            validation.errors.forEach(err => {
                tui.log(chalk.red(`   • ${err}`));
            });
        }

        tui.log('');
        return true;
    }

    // --- Enhanced export ---

    private generateJsonReport(plan: TaskPlan): string {
        const summary = this.planManager.getProgressSummary(plan);
        const estimate = this.planAdapter.estimateRemainingWork(plan);
        const criticalPath = this.dependencyManager.getCriticalPath(plan.tasks);

        return JSON.stringify({
            plan: {
                id: plan.id,
                goal: plan.goal,
                status: plan.status,
                createdAt: plan.createdAt.toISOString(),
                updatedAt: plan.updatedAt.toISOString()
            },
            progress: {
                total: summary.total,
                completed: summary.completed,
                inProgress: summary.inProgress,
                pending: summary.pending,
                failed: summary.failed,
                skipped: summary.skipped,
                percentage: Math.round(summary.percentage)
            },
            estimate: {
                remainingTasks: estimate.pendingTaskCount,
                estimatedTime: estimate.estimatedTimeFormatted,
                blockedTasks: estimate.blockedTasks,
                byPriority: estimate.byPriority
            },
            criticalPath: criticalPath.map(t => t.title),
            tasks: plan.tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                priority: t.priority,
                dependencies: t.dependencies,
                error: t.error
            }))
        }, null, 2);
    }
}
