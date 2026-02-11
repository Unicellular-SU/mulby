// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';

export interface LogAreaProps {
    logs: string[];
}

export const LogArea: React.FC<LogAreaProps> = ({ logs }) => {
    // We only show the last 15 lines to avoid clutter, 
    // though Ink handles scrolling naturally if we don't clear screen constantly.
    // However, for a fixed bottom input, we want a "viewport" for logs.

    // Simple implementation: Just render the logs.
    // In a real TUI we might want a constrained Box with overflow control,
    // but Ink's default behavior + process.stdout usually works fine for scrolling 
    // if we are rendering a full screen app or just appending.

    // Since we are using Ink in a way that "takes over" the last N lines, 
    // we should render logs in a Box that grows.

    const visibleLogs = logs.slice(-20); // Keep last 20 logs visible in the "window"

    return (
        <Box flexDirection="column" paddingBottom={1}>
            {visibleLogs.map((log, index) => (
                <Text key={index} color="white">
                    {log}
                </Text>
            ))}
        </Box>
    );
};
