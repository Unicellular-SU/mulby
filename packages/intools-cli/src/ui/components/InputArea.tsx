// @ts-nocheck
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

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
    { cmd: '/use', desc: 'switch provider' },
    { cmd: '/model', desc: 'switch model' },
];

export const InputArea: React.FC<InputAreaProps> = ({ isPrompting, statusMessage, onSubmit }) => {
    const [query, setQuery] = useState('');
    const [matchingCmds, setMatchingCmds] = useState<typeof SLASH_COMMANDS>([]);

    useInput((input, key) => {
        if (!isPrompting) return;

        // Normalize input newlines (Paste handling)
        // Some pastes use \r, some \r\n. Convert all to \n.
        const normalizedInput = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 1. Handle explicit Enter key (Submit)
        // Only trigger submit if it's a PURE Enter keypress (input is usually \r or empty depending on term)
        // AND not part of a pasted chunk causing normalizedInput to be just \n
        if (key.return) {
            // Check for continuation char '\'
            if (query.trimEnd().endsWith('\\')) {
                const lastSlash = query.lastIndexOf('\\');
                if (lastSlash !== -1) {
                    const next = query.substring(0, lastSlash) + '\n';
                    setQuery(next);
                }
                return;
            }

            // Normal Submit
            if (!query.trim()) return;

            // Submit
            const payload = query;
            setQuery('');
            setMatchingCmds([]);
            onSubmit(payload);
            return;
        }

        // 2. Handle Backspace / Delete
        if (key.backspace || key.delete) {
            if (query.length > 0) {
                setQuery(prev => prev.slice(0, -1));
            }
            return;
        }

        // 3. Handle Regular Input & Paste
        // If the input ITSELF contains a newline (but key.return was NOT triggered OR we ignored it),
        // it means we received a line-feed char directly (often from paste or Shift+Enter in some terms).
        setQuery(prev => {
            const next = prev + normalizedInput;

            // Check slash commands (only single line)
            if (next.startsWith('/') && !next.includes('\n')) {
                const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(next));
                setMatchingCmds(matches);
            } else {
                setMatchingCmds([]);
            }
            return next;
        });
    });

    if (!isPrompting) {
        return (
            <Box borderStyle="round" borderColor="gray">
                <Text color="yellow">{statusMessage || 'Waiting... (System processing)'}</Text>
            </Box>
        );
    }

    // Advanced Stats Calculation
    const getStats = (str: string) => {
        // Ensure we count lines correctly even if split result differs
        const lines = str.split('\n');
        return { lines: lines.length, chars: str.length };
    };

    const { lines, chars } = getStats(query);
    // Only collapse if content is significantly large, allowing manual multi-line entry to be visible.
    // Threshold: > 6 lines or > 1000 chars.
    const shouldCollapse = lines > 6 || chars > 1000;

    return (
        <Box flexDirection="column">
            {matchingCmds.length > 0 && (
                <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor="blue">
                    {matchingCmds.map(c => (
                        <Text key={c.cmd} color="blue">{c.cmd} <Text color="gray">- {c.desc}</Text></Text>
                    ))}
                </Box>
            )}
            <Box borderStyle="round" borderColor={shouldCollapse ? "magenta" : "cyan"} flexDirection="column">
                <Box>
                    <Text color={shouldCollapse ? "magenta" : "green"}>➜ </Text>
                    {shouldCollapse ? (
                        <Text color="magenta" italic>
                            [Multi-line Input: {lines} lines, {chars} chars]
                        </Text>
                    ) : (
                        <Text>
                            {query}
                            <Text color="cyan" inverse>_</Text>
                        </Text>
                    )}
                </Box>
                <Box marginTop={0}>
                    <Text color="gray" dimColor>
                        {shouldCollapse
                            ? '[Enter] submit • [Backsp] delete'
                            : '[Enter] send • [\\ + Enter] newline • [/] cmd'
                        }
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
