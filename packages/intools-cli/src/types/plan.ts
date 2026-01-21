/**
 * Task status types
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Task priority levels
 */
export type TaskPriority = 'high' | 'medium' | 'low';

/**
 * Task complexity levels
 */
export type TaskComplexity = 'simple' | 'medium' | 'complex';

/**
 * Plan status types
 */
export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed';

/**
 * Individual task in a plan
 */
export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    estimatedTokens?: number;
    dependencies: string[];
    acceptanceCriteria: string[];
    files: string[];
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
}

/**
 * Task plan containing multiple tasks
 */
export interface TaskPlan {
    id: string;
    goal: string;
    tasks: Task[];
    totalEstimatedTokens?: number;
    createdAt: Date;
    updatedAt: Date;
    status: PlanStatus;
    currentTaskIndex: number;
}

/**
 * Task analysis result
 */
export interface TaskAnalysis {
    complexity: TaskComplexity;
    estimatedSteps: number;
    requiredFiles: string[];
    dependencies: string[];
    risks: string[];
    shouldPlan: boolean;
    reason?: string;  // AI's explanation for the analysis
}

/**
 * Serializable version of Task (for JSON storage)
 */
export interface SerializableTask extends Omit<Task, 'createdAt' | 'startedAt' | 'completedAt'> {
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
}

/**
 * Serializable version of TaskPlan (for JSON storage)
 */
export interface SerializableTaskPlan extends Omit<TaskPlan, 'tasks' | 'createdAt' | 'updatedAt'> {
    tasks: SerializableTask[];
    createdAt: string;
    updatedAt: string;
}

/**
 * Plan template for reusable task structures
 */
export interface PlanTemplate {
    name: string;
    description: string;
    tasks: TemplateTask[];
    createdAt: string;
    tags: string[];
}

/**
 * Task definition in a template (without runtime state)
 */
export interface TemplateTask {
    title: string;
    description: string;
    priority: TaskPriority;
    dependencies: string[];
    acceptanceCriteria: string[];
    files: string[];
    estimatedTokens?: number;
}
