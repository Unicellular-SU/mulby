// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Box, Static, Text } from 'ink';
import { InputArea } from './components/InputArea';

export const TerminalApp: React.FC = () => {
    // This state management is tricky because we need to bridge external events (logs) 
    // to React state. We'll use a simple event emitter pattern or strictly control it via Props 
    // if we were rendering repeatedly.
    // However, Ink is best used when it controls the render loop.
    // We will need a way to inject "logs" from the outside.
    // For now, let's assume we use a module-level event emitter or store.

    // NOTE: In a real implementation, we'd use a Context or a Global Store (like Zustand outside React) 
    // to feed data into this component, because the "Service" layer needs to call `log()`.
    // See `src/services/tui/index.ts` for how we bridge this.

    return (
        <Box flexDirection="column" padding={1}>
            {/* We will rely on the "TerminalService" to render this component with correct props/context */}
            <TerminalUI />
        </Box>
    );
};

// Internal component that actually hooks into the store/events
import { terminalStore } from '../services/tui/store';

import { SelectArea } from './components/SelectArea';

const TerminalUI: React.FC = () => {
    const [logs, setLogs] = useState<string[]>([]);
    const [isPrompting, setIsPrompting] = useState(false);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectItems, setSelectItems] = useState<any[]>([]);
    const [statusMessage, setStatusMessage] = useState('');

    useEffect(() => {
        const updateState = () => {
            // Important: We must create a new array reference for React to detect change,
            // but for Static, passing the whole growing array works.
            setLogs([...terminalStore.logs]);
            setIsPrompting(terminalStore.isPrompting);
            setStatusMessage(terminalStore.statusMessage);
            setIsSelecting(terminalStore.isSelecting);
            setSelectItems(terminalStore.selectItems);
        };

        // Initial sync
        updateState();

        // Subscribe
        terminalStore.addListener('change', updateState);
        return () => {
            terminalStore.removeListener('change', updateState);
        };
    }, []);

    const handleInput = (value: string) => {
        terminalStore.submitInput(value);
    };

    const handleSelect = (value: string) => {
        terminalStore.submitSelect(value);
    };

    return (
        <Box flexDirection="column" justifyContent="space-between">
            <Static items={logs}>
                {(log, index) => (
                    <Box key={index} paddingBottom={0}>
                        <Text color="white">{log}</Text>
                    </Box>
                )}
            </Static>

            <Box marginTop={1}>
                {isSelecting ? (
                    <SelectArea
                        items={selectItems}
                        onSelect={handleSelect}
                    />
                ) : (
                    <InputArea
                        isPrompting={isPrompting}
                        statusMessage={statusMessage}
                        onSubmit={handleInput}
                    />
                )}
            </Box>
        </Box>
    );
};
