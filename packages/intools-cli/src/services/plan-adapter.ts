import { Task, TaskPlan, TaskStatus } from '../types/plan';
import { DependencyManager } from './dependency-manager';

/**
 * Plan Adapter - handles dynamic plan adjustments
 */
export class PlanAdapter {
    private dependencyManager = new DependencyManager();

    /**
     * Handle task failure and generate recovery tasks
     */
    onTaskFailed(plan: TaskPlan, task: Task, error: string): Task[] {
        const newTasks: Task[] = [];

        // 1. Create a fix task
        const fixTask: Task = {
            id: `fix-${task.id}-${Date.now()}`,
            title: `Fix: ${task.title}`,
            description: `Resolve the error encountered in task "${task.title}": ${error}`,
            status: 'pending',
            priority: 'high',
            dependencies: [],
            acceptanceCriteria: [
                'Error is identified and understood',
                'Fix is implemented',
                'Original task can be retried'
            ],
            files: task.files,
            createdAt: new Date()
        };
        newTasks.push(fixTask);

        // 2. Create a retry task that depends on the fix
        const retryTask: Task = {
            id: `retry-${task.id}-${Date.now()}`,
            title: `Retry: ${task.title}`,
            description: task.description,
            status: 'pending',
            priority: task.priority,
            dependencies: [fixTask.id],
            acceptanceCriteria: task.acceptanceCriteria,
            files: task.files,
            createdAt: new Date()
        };
        newTasks.push(retryTask);

        // 3. Update dependent tasks to point to the retry task
        const dependentTasks = this.dependencyManager.getDependentTasks(plan.tasks, task.id);
        for (const depTask of dependentTasks) {
            const idx = depTask.dependencies.indexOf(task.id);
            if (idx !== -1) {
                depTask.dependencies[idx] = retryTask.id;
            }
        }

        return newTasks;
    }

    /**
     * Analyze failure and suggest recovery strategy
     */
    analyzeFailure(task: Task, error: string): FailureAnalysis {
        const errorLower = error.toLowerCase();

        // Categorize error types
        let category: FailureCategory = 'unknown';
        let suggestions: string[] = [];
        let autoRecoverable = false;

        if (errorLower.includes('not found') || errorLower.includes('no such file')) {
            category = 'missing_resource';
            suggestions = [
                'Check if the file/resource was created in a previous task',
                'Verify file paths are correct',
                'Create missing resources first'
            ];
            autoRecoverable = true;
        } else if (errorLower.includes('permission') || errorLower.includes('access denied')) {
            category = 'permission';
            suggestions = [
                'Check file/directory permissions',
                'Run with elevated privileges if needed',
                'Verify user has write access'
            ];
        } else if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
            category = 'timeout';
            suggestions = [
                'Increase timeout duration',
                'Check network connectivity',
                'Retry the operation'
            ];
            autoRecoverable = true;
        } else if (errorLower.includes('syntax') || errorLower.includes('parse')) {
            category = 'syntax_error';
            suggestions = [
                'Check code syntax',
                'Validate configuration files',
                'Review recent changes'
            ];
        } else if (errorLower.includes('dependency') || errorLower.includes('module not found')) {
            category = 'dependency';
            suggestions = [
                'Install missing dependencies',
                'Check package.json',
                'Run npm/yarn install'
            ];
            autoRecoverable = true;
        } else if (errorLower.includes('type') || errorLower.includes('typescript')) {
            category = 'type_error';
            suggestions = [
                'Fix TypeScript type errors',
                'Check interface definitions',
                'Verify function signatures'
            ];
        }

        return {
            category,
            originalError: error,
            suggestions,
            autoRecoverable,
            affectedTasks: this.dependencyManager.getDependentTasks([], task.id).map(t => t.id)
        };
    }

    /**
     * Reorder tasks based on priority and dependencies
     */
    optimizeTaskOrder(tasks: Task[]): Task[] {
        // First, ensure topological order
        const sorted = this.dependencyManager.topologicalSort(tasks);
        if (!sorted) {
            // Cycle detected, return original order
            return tasks;
        }

        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        // Group by dependency level
        const levels: Task[][] = [];
        const assigned = new Set<string>();

        while (assigned.size < tasks.length) {
            const currentLevel: Task[] = [];

            for (const taskId of sorted) {
                if (assigned.has(taskId)) continue;

                const task = taskMap.get(taskId)!;
                const depsCompleted = task.dependencies.every(d => assigned.has(d));

                if (depsCompleted) {
                    currentLevel.push(task);
                }
            }

            // Sort current level by priority
            currentLevel.sort((a, b) => {
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });

            currentLevel.forEach(t => assigned.add(t.id));
            levels.push(currentLevel);
        }

        return levels.flat();
    }

    /**
     * Suggest task breakdown for complex tasks
     */
    suggestBreakdown(task: Task): Task[] {
        const subtasks: Task[] = [];

        // Based on task description length and complexity indicators
        const complexityIndicators = ['implement', 'create', 'design', 'refactor', 'migrate'];
        const hasComplexity = complexityIndicators.some(i =>
            task.title.toLowerCase().includes(i) ||
            task.description.toLowerCase().includes(i)
        );

        if (!hasComplexity) {
            return subtasks;
        }

        // Generate suggested subtasks
        if (task.files.length > 2) {
            // Multiple files - suggest per-file tasks
            task.files.forEach((file, idx) => {
                subtasks.push({
                    id: `${task.id}-sub-${idx + 1}`,
                    title: `Update ${file.split('/').pop()}`,
                    description: `Implement changes in ${file}`,
                    status: 'pending',
                    priority: task.priority,
                    dependencies: idx === 0 ? task.dependencies : [`${task.id}-sub-${idx}`],
                    acceptanceCriteria: [`Changes in ${file} are complete and working`],
                    files: [file],
                    createdAt: new Date()
                });
            });
        }

        return subtasks;
    }

    /**
     * Estimate remaining work
     */
    estimateRemainingWork(plan: TaskPlan): WorkEstimate {
        const pendingTasks = plan.tasks.filter(t =>
            t.status === 'pending' || t.status === 'in_progress'
        );
        const completedTasks = plan.tasks.filter(t => t.status === 'completed');

        // Calculate average completion time from completed tasks
        let avgCompletionTime = 0;
        if (completedTasks.length > 0) {
            const completionTimes = completedTasks
                .filter(t => t.startedAt && t.completedAt)
                .map(t => t.completedAt!.getTime() - t.startedAt!.getTime());

            if (completionTimes.length > 0) {
                avgCompletionTime = completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length;
            }
        }

        // Estimate remaining time
        const estimatedRemainingTime = avgCompletionTime * pendingTasks.length;

        // Calculate by priority
        const byPriority = {
            high: pendingTasks.filter(t => t.priority === 'high').length,
            medium: pendingTasks.filter(t => t.priority === 'medium').length,
            low: pendingTasks.filter(t => t.priority === 'low').length
        };

        // Get critical path
        const criticalPath = this.dependencyManager.getCriticalPath(pendingTasks);

        return {
            pendingTaskCount: pendingTasks.length,
            estimatedTimeMs: estimatedRemainingTime,
            estimatedTimeFormatted: this.formatDuration(estimatedRemainingTime),
            byPriority,
            criticalPathLength: criticalPath.length,
            blockedTasks: pendingTasks.filter(t =>
                !this.dependencyManager.canExecute(t, new Set(completedTasks.map(c => c.id)))
            ).length
        };
    }

    private formatDuration(ms: number): string {
        if (ms === 0) return 'Unknown';

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `~${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `~${minutes}m`;
        } else {
            return `~${seconds}s`;
        }
    }
}

export type FailureCategory =
    | 'missing_resource'
    | 'permission'
    | 'timeout'
    | 'syntax_error'
    | 'dependency'
    | 'type_error'
    | 'unknown';

export interface FailureAnalysis {
    category: FailureCategory;
    originalError: string;
    suggestions: string[];
    autoRecoverable: boolean;
    affectedTasks: string[];
}

export interface WorkEstimate {
    pendingTaskCount: number;
    estimatedTimeMs: number;
    estimatedTimeFormatted: string;
    byPriority: {
        high: number;
        medium: number;
        low: number;
    };
    criticalPathLength: number;
    blockedTasks: number;
}
