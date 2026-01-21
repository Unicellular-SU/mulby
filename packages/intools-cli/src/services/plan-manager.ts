import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
    Task,
    TaskPlan,
    TaskStatus,
    PlanStatus,
    SerializableTask,
    SerializableTaskPlan,
    PlanTemplate
} from '../types/plan';

/**
 * Plan Manager - handles task plan creation, persistence, and management
 */
export class PlanManager {
    private plansDir: string;
    private sessionsDir: string;

    constructor(baseDir: string = '.intools') {
        this.plansDir = path.join(baseDir, 'plans');
        this.sessionsDir = path.join(baseDir, 'sessions');
        this.ensureDirectories();
    }

    /**
     * Ensure required directories exist
     */
    private ensureDirectories(): void {
        fs.ensureDirSync(this.plansDir);
        fs.ensureDirSync(path.join(this.plansDir, 'templates'));
        fs.ensureDirSync(this.sessionsDir);
    }

    /**
     * Create a new task plan
     */
    createPlan(goal: string, tasks: Omit<Task, 'id' | 'createdAt'>[]): TaskPlan {
        const plan: TaskPlan = {
            id: `plan-${Date.now()}-${uuidv4().slice(0, 8)}`,
            goal,
            tasks: tasks.map((t, index) => ({
                ...t,
                id: `task-${index + 1}`,
                createdAt: new Date()
            })),
            totalEstimatedTokens: tasks.reduce((sum, t) => sum + (t.estimatedTokens || 0), 0),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'draft',
            currentTaskIndex: 0
        };

        return plan;
    }

    /**
     * Save plan to file
     */
    async savePlan(plan: TaskPlan, sessionId?: string): Promise<void> {
        const serializable = this.toSerializable(plan);

        // Save to plans directory
        const planPath = path.join(this.plansDir, `${plan.id}.json`);
        await fs.writeJson(planPath, serializable, { spaces: 2 });

        // Also save to session directory if sessionId provided
        if (sessionId) {
            const sessionDir = path.join(this.sessionsDir, sessionId);
            await fs.ensureDir(sessionDir);
            const sessionPlanPath = path.join(sessionDir, 'plan.json');
            await fs.writeJson(sessionPlanPath, serializable, { spaces: 2 });
        }
    }

    /**
     * Load plan from file
     */
    async loadPlan(planId: string): Promise<TaskPlan | null> {
        const planPath = path.join(this.plansDir, `${planId}.json`);

        if (!await fs.pathExists(planPath)) {
            return null;
        }

        const serializable: SerializableTaskPlan = await fs.readJson(planPath);
        return this.fromSerializable(serializable);
    }

    /**
     * Load plan from session
     */
    async loadSessionPlan(sessionId: string): Promise<TaskPlan | null> {
        const sessionPlanPath = path.join(this.sessionsDir, sessionId, 'plan.json');

        if (!await fs.pathExists(sessionPlanPath)) {
            return null;
        }

        const serializable: SerializableTaskPlan = await fs.readJson(sessionPlanPath);
        return this.fromSerializable(serializable);
    }

    /**
     * Update task status
     */
    updateTaskStatus(plan: TaskPlan, taskId: string, status: TaskStatus, error?: string): TaskPlan {
        const task = plan.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        task.status = status;
        task.error = error;

        if (status === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date();
        }

        if (status === 'completed' || status === 'failed' || status === 'skipped') {
            task.completedAt = new Date();
        }

        plan.updatedAt = new Date();

        // Update plan status
        this.updatePlanStatus(plan);

        return plan;
    }

    /**
     * Update plan status based on task statuses
     */
    private updatePlanStatus(plan: TaskPlan): void {
        const allCompleted = plan.tasks.every(t =>
            t.status === 'completed' || t.status === 'skipped'
        );
        const anyFailed = plan.tasks.some(t => t.status === 'failed');
        const anyInProgress = plan.tasks.some(t => t.status === 'in_progress');

        if (allCompleted) {
            plan.status = 'completed';
        } else if (anyFailed) {
            plan.status = 'failed';
        } else if (anyInProgress) {
            plan.status = 'in_progress';
        }
    }

    /**
     * Get next pending task
     */
    getNextTask(plan: TaskPlan): Task | null {
        const completedTaskIds = new Set(
            plan.tasks
                .filter(t => t.status === 'completed' || t.status === 'skipped')
                .map(t => t.id)
        );

        // Find first pending task whose dependencies are satisfied
        for (const task of plan.tasks) {
            if (task.status !== 'pending') continue;

            const dependenciesSatisfied = task.dependencies.every(depId =>
                completedTaskIds.has(depId)
            );

            if (dependenciesSatisfied) {
                return task;
            }
        }

        return null;
    }

    /**
     * Calculate progress percentage
     */
    calculateProgress(plan: TaskPlan): number {
        const total = plan.tasks.length;
        if (total === 0) return 0;

        const completed = plan.tasks.filter(t => t.status === 'completed').length;
        const inProgress = plan.tasks.filter(t => t.status === 'in_progress').length;

        // In-progress tasks count as 0.5
        return ((completed + inProgress * 0.5) / total) * 100;
    }

    /**
     * Get progress summary
     */
    getProgressSummary(plan: TaskPlan): {
        total: number;
        completed: number;
        inProgress: number;
        pending: number;
        failed: number;
        skipped: number;
        percentage: number;
    } {
        const total = plan.tasks.length;
        const completed = plan.tasks.filter(t => t.status === 'completed').length;
        const inProgress = plan.tasks.filter(t => t.status === 'in_progress').length;
        const pending = plan.tasks.filter(t => t.status === 'pending').length;
        const failed = plan.tasks.filter(t => t.status === 'failed').length;
        const skipped = plan.tasks.filter(t => t.status === 'skipped').length;

        return {
            total,
            completed,
            inProgress,
            pending,
            failed,
            skipped,
            percentage: this.calculateProgress(plan)
        };
    }

    /**
     * Add task to plan
     */
    addTask(plan: TaskPlan, task: Omit<Task, 'id' | 'createdAt'>, afterTaskId?: string): TaskPlan {
        const newTask: Task = {
            ...task,
            id: `task-${plan.tasks.length + 1}`,
            createdAt: new Date()
        };

        if (afterTaskId) {
            const index = plan.tasks.findIndex(t => t.id === afterTaskId);
            if (index !== -1) {
                plan.tasks.splice(index + 1, 0, newTask);
            } else {
                plan.tasks.push(newTask);
            }
        } else {
            plan.tasks.push(newTask);
        }

        plan.updatedAt = new Date();
        return plan;
    }

    /**
     * Remove task from plan
     */
    removeTask(plan: TaskPlan, taskId: string): TaskPlan {
        const index = plan.tasks.findIndex(t => t.id === taskId);
        if (index === -1) {
            throw new Error(`Task ${taskId} not found`);
        }

        // Check if other tasks depend on this task
        const dependentTasks = plan.tasks.filter(t =>
            t.dependencies.includes(taskId)
        );

        if (dependentTasks.length > 0) {
            throw new Error(
                `Cannot remove task ${taskId}: ${dependentTasks.length} tasks depend on it`
            );
        }

        plan.tasks.splice(index, 1);
        plan.updatedAt = new Date();
        return plan;
    }

    /**
     * List all plans
     */
    async listPlans(): Promise<TaskPlan[]> {
        const files = await fs.readdir(this.plansDir);
        const planFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('template-'));

        const plans: TaskPlan[] = [];
        for (const file of planFiles) {
            const planPath = path.join(this.plansDir, file);
            const serializable: SerializableTaskPlan = await fs.readJson(planPath);
            plans.push(this.fromSerializable(serializable));
        }

        return plans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    /**
     * Delete plan
     */
    async deletePlan(planId: string): Promise<void> {
        const planPath = path.join(this.plansDir, `${planId}.json`);
        if (await fs.pathExists(planPath)) {
            await fs.remove(planPath);
        }
    }

    // ========== Template System ==========

    /**
     * Save plan as a template
     */
    async saveTemplate(plan: TaskPlan, templateName: string): Promise<void> {
        const template: PlanTemplate = {
            name: templateName,
            description: plan.goal,
            tasks: plan.tasks.map(t => ({
                title: t.title,
                description: t.description,
                priority: t.priority,
                dependencies: t.dependencies,
                acceptanceCriteria: t.acceptanceCriteria,
                files: t.files,
                estimatedTokens: t.estimatedTokens
            })),
            createdAt: new Date().toISOString(),
            tags: this.inferTags(plan)
        };

        const templatePath = path.join(this.plansDir, 'templates', `${templateName}.json`);
        await fs.writeJson(templatePath, template, { spaces: 2 });
    }

    /**
     * Load a template and create a new plan from it
     */
    async loadTemplate(templateName: string, customGoal?: string): Promise<TaskPlan | null> {
        const templatePath = path.join(this.plansDir, 'templates', `${templateName}.json`);

        if (!await fs.pathExists(templatePath)) {
            return null;
        }

        const template: PlanTemplate = await fs.readJson(templatePath);

        const plan = this.createPlan(
            customGoal || template.description,
            template.tasks.map(t => ({
                ...t,
                status: 'pending' as const
            }))
        );

        return plan;
    }

    /**
     * List all available templates
     */
    async listTemplates(): Promise<PlanTemplate[]> {
        const templatesDir = path.join(this.plansDir, 'templates');
        await fs.ensureDir(templatesDir);

        const files = await fs.readdir(templatesDir);
        const templates: PlanTemplate[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const templatePath = path.join(templatesDir, file);
                const template: PlanTemplate = await fs.readJson(templatePath);
                templates.push(template);
            }
        }

        return templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Delete a template
     */
    async deleteTemplate(templateName: string): Promise<boolean> {
        const templatePath = path.join(this.plansDir, 'templates', `${templateName}.json`);
        if (await fs.pathExists(templatePath)) {
            await fs.remove(templatePath);
            return true;
        }
        return false;
    }

    /**
     * Get built-in templates
     */
    getBuiltInTemplates(): PlanTemplate[] {
        return [
            {
                name: 'feature',
                description: 'Standard feature implementation workflow',
                tasks: [
                    {
                        title: 'Analyze requirements',
                        description: 'Understand the feature requirements and identify affected components',
                        priority: 'high',
                        dependencies: [],
                        acceptanceCriteria: ['Requirements are clear', 'Affected files identified'],
                        files: []
                    },
                    {
                        title: 'Design solution',
                        description: 'Design the technical approach and data structures',
                        priority: 'high',
                        dependencies: ['task-1'],
                        acceptanceCriteria: ['Technical design documented', 'Edge cases considered'],
                        files: []
                    },
                    {
                        title: 'Implement core functionality',
                        description: 'Implement the main feature logic',
                        priority: 'high',
                        dependencies: ['task-2'],
                        acceptanceCriteria: ['Core functionality works', 'Code follows project conventions'],
                        files: []
                    },
                    {
                        title: 'Add tests',
                        description: 'Write unit and integration tests',
                        priority: 'medium',
                        dependencies: ['task-3'],
                        acceptanceCriteria: ['Tests cover main scenarios', 'All tests pass'],
                        files: []
                    },
                    {
                        title: 'Review and refine',
                        description: 'Code review, documentation, and final polish',
                        priority: 'low',
                        dependencies: ['task-4'],
                        acceptanceCriteria: ['Code is clean', 'Documentation updated'],
                        files: []
                    }
                ],
                createdAt: '2026-01-01T00:00:00Z',
                tags: ['feature', 'standard']
            },
            {
                name: 'bugfix',
                description: 'Bug fix workflow',
                tasks: [
                    {
                        title: 'Reproduce the bug',
                        description: 'Understand and consistently reproduce the issue',
                        priority: 'high',
                        dependencies: [],
                        acceptanceCriteria: ['Bug can be reproduced', 'Steps documented'],
                        files: []
                    },
                    {
                        title: 'Identify root cause',
                        description: 'Debug and find the source of the problem',
                        priority: 'high',
                        dependencies: ['task-1'],
                        acceptanceCriteria: ['Root cause identified', 'Fix approach determined'],
                        files: []
                    },
                    {
                        title: 'Implement fix',
                        description: 'Fix the bug with minimal code changes',
                        priority: 'high',
                        dependencies: ['task-2'],
                        acceptanceCriteria: ['Bug is fixed', 'No regressions introduced'],
                        files: []
                    },
                    {
                        title: 'Add regression test',
                        description: 'Write a test to prevent the bug from recurring',
                        priority: 'medium',
                        dependencies: ['task-3'],
                        acceptanceCriteria: ['Test covers the bug scenario', 'Test passes'],
                        files: []
                    }
                ],
                createdAt: '2026-01-01T00:00:00Z',
                tags: ['bugfix', 'standard']
            },
            {
                name: 'refactor',
                description: 'Code refactoring workflow',
                tasks: [
                    {
                        title: 'Analyze current code',
                        description: 'Understand the existing implementation and its issues',
                        priority: 'high',
                        dependencies: [],
                        acceptanceCriteria: ['Current structure understood', 'Pain points identified'],
                        files: []
                    },
                    {
                        title: 'Design new structure',
                        description: 'Plan the improved architecture',
                        priority: 'high',
                        dependencies: ['task-1'],
                        acceptanceCriteria: ['New design documented', 'Migration path clear'],
                        files: []
                    },
                    {
                        title: 'Ensure test coverage',
                        description: 'Add tests for existing functionality before refactoring',
                        priority: 'high',
                        dependencies: ['task-2'],
                        acceptanceCriteria: ['Critical paths tested', 'Tests pass'],
                        files: []
                    },
                    {
                        title: 'Refactor incrementally',
                        description: 'Apply changes in small, verifiable steps',
                        priority: 'high',
                        dependencies: ['task-3'],
                        acceptanceCriteria: ['Code improved', 'Tests still pass'],
                        files: []
                    },
                    {
                        title: 'Verify and clean up',
                        description: 'Final verification and removal of old code',
                        priority: 'medium',
                        dependencies: ['task-4'],
                        acceptanceCriteria: ['All tests pass', 'No dead code remains'],
                        files: []
                    }
                ],
                createdAt: '2026-01-01T00:00:00Z',
                tags: ['refactor', 'standard']
            }
        ];
    }

    /**
     * Infer tags from plan content
     */
    private inferTags(plan: TaskPlan): string[] {
        const tags: string[] = [];
        const goalLower = plan.goal.toLowerCase();

        if (goalLower.includes('fix') || goalLower.includes('bug')) {
            tags.push('bugfix');
        }
        if (goalLower.includes('feature') || goalLower.includes('implement') || goalLower.includes('add')) {
            tags.push('feature');
        }
        if (goalLower.includes('refactor') || goalLower.includes('improve') || goalLower.includes('optimize')) {
            tags.push('refactor');
        }
        if (goalLower.includes('test')) {
            tags.push('testing');
        }
        if (goalLower.includes('doc')) {
            tags.push('documentation');
        }

        return tags;
    }

    /**
     * Convert TaskPlan to serializable format
     */
    private toSerializable(plan: TaskPlan): SerializableTaskPlan {
        return {
            ...plan,
            tasks: plan.tasks.map(t => ({
                ...t,
                createdAt: t.createdAt.toISOString(),
                startedAt: t.startedAt?.toISOString(),
                completedAt: t.completedAt?.toISOString()
            })),
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString()
        };
    }

    /**
     * Convert serializable format to TaskPlan
     */
    private fromSerializable(serializable: SerializableTaskPlan): TaskPlan {
        return {
            ...serializable,
            tasks: serializable.tasks.map(t => ({
                ...t,
                createdAt: new Date(t.createdAt),
                startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
                completedAt: t.completedAt ? new Date(t.completedAt) : undefined
            })),
            createdAt: new Date(serializable.createdAt),
            updatedAt: new Date(serializable.updatedAt)
        };
    }
}
