import { Task, TaskPlan } from '../types/plan';

/**
 * Dependency Manager - handles task dependency analysis and management
 */
export class DependencyManager {
    /**
     * Check if a task can be executed (all dependencies are satisfied)
     */
    canExecute(task: Task, completedTasks: Set<string>): boolean {
        return task.dependencies.every(depId => completedTasks.has(depId));
    }

    /**
     * Get all tasks that can be executed in parallel
     */
    getParallelTasks(tasks: Task[], completedTasks: Set<string>): Task[] {
        return tasks.filter(t =>
            t.status === 'pending' &&
            this.canExecute(t, completedTasks)
        );
    }

    /**
     * Detect cyclic dependencies using DFS
     * Returns the cycle path if found, null otherwise
     */
    detectCyclicDependency(tasks: Task[]): string[] | null {
        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (taskId: string): string[] | null => {
            visited.add(taskId);
            recursionStack.add(taskId);
            path.push(taskId);

            const task = taskMap.get(taskId);
            if (task) {
                for (const depId of task.dependencies) {
                    if (!visited.has(depId)) {
                        const cycle = dfs(depId);
                        if (cycle) return cycle;
                    } else if (recursionStack.has(depId)) {
                        // Found a cycle
                        const cycleStart = path.indexOf(depId);
                        return path.slice(cycleStart).concat(depId);
                    }
                }
            }

            path.pop();
            recursionStack.delete(taskId);
            return null;
        };

        for (const task of tasks) {
            if (!visited.has(task.id)) {
                const cycle = dfs(task.id);
                if (cycle) return cycle;
            }
        }

        return null;
    }

    /**
     * Topological sort of tasks based on dependencies
     * Returns sorted task IDs or null if cycle detected
     */
    topologicalSort(tasks: Task[]): string[] | null {
        const cycle = this.detectCyclicDependency(tasks);
        if (cycle) return null;

        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        const visited = new Set<string>();
        const result: string[] = [];

        const visit = (taskId: string) => {
            if (visited.has(taskId)) return;
            visited.add(taskId);

            const task = taskMap.get(taskId);
            if (task) {
                for (const depId of task.dependencies) {
                    visit(depId);
                }
            }
            result.push(taskId);
        };

        for (const task of tasks) {
            visit(task.id);
        }

        return result;
    }

    /**
     * Get all tasks that depend on a given task (direct and indirect)
     */
    getDependentTasks(tasks: Task[], taskId: string): Task[] {
        const dependents: Task[] = [];
        const visited = new Set<string>();

        const findDependents = (id: string) => {
            for (const task of tasks) {
                if (task.dependencies.includes(id) && !visited.has(task.id)) {
                    visited.add(task.id);
                    dependents.push(task);
                    findDependents(task.id);
                }
            }
        };

        findDependents(taskId);
        return dependents;
    }

    /**
     * Get all tasks that a given task depends on (direct and indirect)
     */
    getPrerequisiteTasks(tasks: Task[], taskId: string): Task[] {
        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        const prerequisites: Task[] = [];
        const visited = new Set<string>();

        const findPrerequisites = (id: string) => {
            const task = taskMap.get(id);
            if (!task) return;

            for (const depId of task.dependencies) {
                if (!visited.has(depId)) {
                    visited.add(depId);
                    const depTask = taskMap.get(depId);
                    if (depTask) {
                        prerequisites.push(depTask);
                        findPrerequisites(depId);
                    }
                }
            }
        };

        findPrerequisites(taskId);
        return prerequisites;
    }

    /**
     * Calculate the critical path (longest dependency chain)
     */
    getCriticalPath(tasks: Task[]): Task[] {
        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        const memo = new Map<string, Task[]>();

        const getLongestPath = (taskId: string): Task[] => {
            if (memo.has(taskId)) return memo.get(taskId)!;

            const task = taskMap.get(taskId);
            if (!task) return [];

            if (task.dependencies.length === 0) {
                const path = [task];
                memo.set(taskId, path);
                return path;
            }

            let longestDepPath: Task[] = [];
            for (const depId of task.dependencies) {
                const depPath = getLongestPath(depId);
                if (depPath.length > longestDepPath.length) {
                    longestDepPath = depPath;
                }
            }

            const path = [...longestDepPath, task];
            memo.set(taskId, path);
            return path;
        };

        let criticalPath: Task[] = [];
        for (const task of tasks) {
            const path = getLongestPath(task.id);
            if (path.length > criticalPath.length) {
                criticalPath = path;
            }
        }

        return criticalPath;
    }

    /**
     * Generate dependency visualization (ASCII tree)
     */
    visualizeDependencies(tasks: Task[]): string {
        const lines: string[] = [];
        const taskMap = new Map<string, Task>();
        tasks.forEach(t => taskMap.set(t.id, t));

        // Find root tasks (no dependencies)
        const rootTasks = tasks.filter(t => t.dependencies.length === 0);

        const renderTask = (task: Task, prefix: string, isLast: boolean) => {
            const connector = isLast ? '└── ' : '├── ';
            const statusIcon = this.getStatusIcon(task.status);
            lines.push(`${prefix}${connector}${statusIcon} ${task.title}`);

            // Find tasks that depend on this one
            const children = tasks.filter(t => t.dependencies.includes(task.id));
            const childPrefix = prefix + (isLast ? '    ' : '│   ');

            children.forEach((child, idx) => {
                renderTask(child, childPrefix, idx === children.length - 1);
            });
        };

        lines.push('Dependency Tree:');
        rootTasks.forEach((task, idx) => {
            renderTask(task, '', idx === rootTasks.length - 1);
        });

        return lines.join('\n');
    }

    /**
     * Validate dependencies (check for invalid references)
     */
    validateDependencies(tasks: Task[]): { valid: boolean; errors: string[] } {
        const taskIds = new Set(tasks.map(t => t.id));
        const errors: string[] = [];

        for (const task of tasks) {
            for (const depId of task.dependencies) {
                if (!taskIds.has(depId)) {
                    errors.push(`Task "${task.title}" references non-existent dependency: ${depId}`);
                }
                if (depId === task.id) {
                    errors.push(`Task "${task.title}" has self-dependency`);
                }
            }
        }

        const cycle = this.detectCyclicDependency(tasks);
        if (cycle) {
            errors.push(`Cyclic dependency detected: ${cycle.join(' -> ')}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    private getStatusIcon(status: Task['status']): string {
        switch (status) {
            case 'completed': return '✅';
            case 'in_progress': return '🔄';
            case 'pending': return '⏸️';
            case 'failed': return '❌';
            case 'skipped': return '⏭️';
            default: return '  ';
        }
    }
}
