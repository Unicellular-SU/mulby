// @ts-nocheck
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TaskPlan, Task } from '../../types/plan';

export interface PlanPanelProps {
    plan: TaskPlan | null;
    collapsed?: boolean;
}

/**
 * Get status icon for task
 */
function getStatusIcon(status: Task['status']): string {
    switch (status) {
        case 'completed':
            return '✅';
        case 'in_progress':
            return '🔄';
        case 'pending':
            return '⏸️ ';
        case 'failed':
            return '❌';
        case 'skipped':
            return '⏭️ ';
        default:
            return '  ';
    }
}

/**
 * Get priority color
 */
function getPriorityColor(priority: Task['priority']): string {
    switch (priority) {
        case 'high':
            return 'red';
        case 'medium':
            return 'yellow';
        case 'low':
            return 'gray';
        default:
            return 'white';
    }
}

/**
 * Plan Panel Component - displays task plan with collapsible view
 */
export const PlanPanel: React.FC<PlanPanelProps> = ({ plan, collapsed = false }) => {
    if (!plan) {
        return null;
    }

    const completedCount = plan.tasks.filter(t => t.status === 'completed').length;
    const totalCount = plan.tasks.length;
    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Collapsed view - just show summary
    if (collapsed) {
        const currentTask = plan.tasks.find(t => t.status === 'in_progress');
        const currentTaskTitle = currentTask ? currentTask.title : 'Waiting...';

        return (
            <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
                <Text color="cyan">
                    📋 Tasks: {completedCount}/{totalCount} ({progress}%) | 🔄 {currentTaskTitle}
                </Text>
            </Box>
        );
    }

    // Expanded view - show all tasks
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            marginBottom={1}
        >
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    📋 Task Plan: {plan.goal}
                </Text>
            </Box>

            {/* Progress bar */}
            <Box marginBottom={1}>
                <Text color="gray">
                    Progress: {completedCount}/{totalCount} ({progress}%)
                </Text>
            </Box>

            {/* Task list */}
            <Box flexDirection="column">
                {plan.tasks.map((task, index) => {
                    const isCurrentTask = task.status === 'in_progress';
                    const statusIcon = getStatusIcon(task.status);

                    return (
                        <Box key={task.id} marginBottom={0}>
                            <Text
                                color={isCurrentTask ? 'cyan' : 'white'}
                                bold={isCurrentTask}
                            >
                                {statusIcon} {index + 1}. {task.title}
                                {task.status === 'in_progress' && ' (current)'}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            {/* Status */}
            <Box marginTop={1}>
                <Text color="gray" dimColor>
                    Status: {plan.status} | Updated: {plan.updatedAt.toLocaleTimeString()}
                </Text>
            </Box>
        </Box>
    );
};

/**
 * Detailed Plan View Component - shows full task details
 */
export interface DetailedPlanViewProps {
    plan: TaskPlan;
}

export const DetailedPlanView: React.FC<DetailedPlanViewProps> = ({ plan }) => {
    const completedCount = plan.tasks.filter(t => t.status === 'completed').length;
    const totalCount = plan.tasks.length;

    return (
        <Box flexDirection="column" paddingX={2}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    📋 Task Plan: {plan.goal}
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                </Text>
            </Box>

            {/* Tasks */}
            {plan.tasks.map((task, index) => (
                <Box key={task.id} flexDirection="column" marginBottom={2}>
                    {/* Task title */}
                    <Box>
                        <Text color={getPriorityColor(task.priority)}>
                            {getStatusIcon(task.status)} {index + 1}. {task.title}
                        </Text>
                    </Box>

                    {/* Description */}
                    <Box paddingLeft={4}>
                        <Text color="gray">Description: {task.description}</Text>
                    </Box>

                    {/* Acceptance criteria */}
                    {task.acceptanceCriteria.length > 0 && (
                        <Box paddingLeft={4} flexDirection="column">
                            <Text color="gray">Acceptance Criteria:</Text>
                            {task.acceptanceCriteria.map((criterion, i) => (
                                <Box key={i} paddingLeft={2}>
                                    <Text color="gray">• {criterion}</Text>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* Files */}
                    {task.files.length > 0 && (
                        <Box paddingLeft={4} flexDirection="column">
                            <Text color="gray">Files:</Text>
                            {task.files.map((file, i) => (
                                <Box key={i} paddingLeft={2}>
                                    <Text color="gray">• {file}</Text>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* Dependencies */}
                    {task.dependencies.length > 0 && (
                        <Box paddingLeft={4}>
                            <Text color="gray">
                                Dependencies: {task.dependencies.join(', ')}
                            </Text>
                        </Box>
                    )}

                    {/* Priority */}
                    <Box paddingLeft={4}>
                        <Text color={getPriorityColor(task.priority)}>
                            Priority: {task.priority}
                        </Text>
                    </Box>

                    {/* Error (if failed) */}
                    {task.error && (
                        <Box paddingLeft={4}>
                            <Text color="red">Error: {task.error}</Text>
                        </Box>
                    )}
                </Box>
            ))}

            {/* Footer */}
            <Box marginTop={1}>
                <Text bold color="cyan">
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text color="gray">
                    Progress: {completedCount}/{totalCount} | Status: {plan.status}
                </Text>
            </Box>
            {plan.totalEstimatedTokens && (
                <Box marginBottom={1}>
                    <Text color="gray">
                        Estimated Total Tokens: ~{plan.totalEstimatedTokens}
                    </Text>
                </Box>
            )}
        </Box>
    );
};
