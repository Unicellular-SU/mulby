// @ts-nocheck
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface InputAreaProps {
    isPrompting: boolean;
    statusMessage: string;
    onSubmit: (value: string) => void;
}

const SLASH_COMMANDS = [
    { cmd: '/help', desc: 'show help' },
    { cmd: '/exit', desc: 'exit session' },
    { cmd: '/clear', desc: 'clear context' },
    { cmd: '/tokens', desc: 'show token usage' },
    { cmd: '/compress', desc: 'compress history' },
];

export const InputArea: React.FC<InputAreaProps> = ({ isPrompting, statusMessage, onSubmit }) => {
    const [query, setQuery] = useState('');
    const [matchingCmds, setMatchingCmds] = useState<typeof SLASH_COMMANDS>([]);

    const handleChange = (value: string) => {
        setQuery(value);
        if (value.startsWith('/')) {
            const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(value));
            setMatchingCmds(matches);
        } else {
            setMatchingCmds([]);
        }
    };

    const handleSubmit = (value: string) => {
        setQuery('');
        setMatchingCmds([]);
        onSubmit(value);
    };

    if (!isPrompting) {
        return (
            <Box borderStyle="round" borderColor="gray">
                <Text color="yellow">{statusMessage || 'Waiting... (System processing)'}</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            {matchingCmds.length > 0 && (
                <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor="blue">
                    {matchingCmds.map(c => (
                        <Text key={c.cmd} color="blue">{c.cmd} <Text color="gray">- {c.desc}</Text></Text>
                    ))}
                </Box>
            )}
            <Box borderStyle="round" borderColor="cyan" flexDirection="column">
                <Box>
                    <Text color="green">➜ </Text>
                    <TextInput
                        value={query}
                        onChange={handleChange}
                        onSubmit={handleSubmit}
                        placeholder="Type a command or message..."
                    />
                </Box>
                <Box marginTop={0}>
                    <Text color="gray" dimColor>
                        [Enter] to send • [/] for commands
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
