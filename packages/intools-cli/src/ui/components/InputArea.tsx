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
    const [cursorPos, setCursorPos] = useState(0);
    const [matchingCmds, setMatchingCmds] = useState<typeof SLASH_COMMANDS>([]);

    useInput((input, key) => {
        if (!isPrompting) return;

        // Normalize input newlines (Paste handling)
        // Some pastes use \r, some \r\n. Convert all to \n.
        const normalizedInput = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 1. Handle Shift+Enter for newline (cross-platform support)
        // Different terminals handle Shift+Enter differently:
        // - Standard: key.return && key.shift
        // - Mac/Linux terminals: Ctrl+J (ASCII 106, character 'j')
        // - Some terminals: Direct '\n' without key.return flag
        if (
            (key.return && key.shift) ||                    // Standard Shift+Enter
            (key.ctrl && input === 'j') ||                  // Mac/Linux: Ctrl+J
            (normalizedInput === '\n' && !key.return)       // Direct newline character
        ) {
            setQuery(prev => {
                const next = prev.slice(0, cursorPos) + '\n' + prev.slice(cursorPos);
                setCursorPos(cursorPos + 1);
                return next;
            });
            return;
        }

        // 2. Handle explicit Enter key (Submit)
        if (key.return) {
            // Check for continuation char '\'
            if (query.trimEnd().endsWith('\\')) {
                const lastSlash = query.lastIndexOf('\\');
                if (lastSlash !== -1) {
                    const next = query.substring(0, lastSlash) + '\n';
                    setQuery(next);
                    setCursorPos(next.length);
                }
                return;
            }

            // Normal Submit
            if (!query.trim()) return;

            // Submit
            const payload = query;
            setQuery('');
            setCursorPos(0);
            setMatchingCmds([]);
            onSubmit(payload);
            return;
        }

        // 3. Handle Arrow Keys for cursor movement
        if (key.leftArrow) {
            setCursorPos(prev => Math.max(0, prev - 1));
            return;
        }
        if (key.rightArrow) {
            setCursorPos(prev => Math.min(query.length, prev + 1));
            return;
        }
        if (key.upArrow) {
            // Move cursor up one line
            const lines = query.slice(0, cursorPos).split('\n');
            if (lines.length > 1) {
                const currentLinePos = lines[lines.length - 1].length;
                const prevLineLength = lines[lines.length - 2].length;
                const newPos = cursorPos - currentLinePos - 1 - (prevLineLength - Math.min(currentLinePos, prevLineLength));
                setCursorPos(Math.max(0, newPos));
            }
            return;
        }
        if (key.downArrow) {
            // Move cursor down one line
            const beforeCursor = query.slice(0, cursorPos);
            const afterCursor = query.slice(cursorPos);
            const currentLinePos = beforeCursor.split('\n').pop()?.length || 0;
            const nextLineEnd = afterCursor.indexOf('\n');

            if (nextLineEnd !== -1) {
                const nextLineLength = afterCursor.slice(0, nextLineEnd).length;
                const newPos = cursorPos + nextLineLength + 1 - currentLinePos + Math.min(currentLinePos, nextLineLength);
                setCursorPos(Math.min(query.length, newPos));
            } else if (afterCursor.length > 0) {
                // Move to end if on last line
                setCursorPos(query.length);
            }
            return;
        }

        // 4. Handle Backspace / Delete
        if (key.backspace || key.delete) {
            if (cursorPos > 0) {
                setQuery(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
                setCursorPos(prev => prev - 1);
            }
            return;
        }

        // 5. Handle Regular Input & Paste
        setQuery(prev => {
            const next = prev.slice(0, cursorPos) + normalizedInput + prev.slice(cursorPos);
            setCursorPos(cursorPos + normalizedInput.length);

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
            <Box borderStyle="round" borderColor="gray" width="100%">
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
        <Box flexDirection="column" width="100%">
            {matchingCmds.length > 0 && (
                <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor="blue" width="100%">
                    {matchingCmds.map(c => (
                        <Text key={c.cmd} color="blue">{c.cmd} <Text color="gray">- {c.desc}</Text></Text>
                    ))}
                </Box>
            )}
            <Box borderStyle="round" borderColor={shouldCollapse ? "magenta" : "cyan"} flexDirection="column" width="100%">
                <Box>
                    <Text color={shouldCollapse ? "magenta" : "green"}>➜ </Text>
                    {shouldCollapse ? (
                        <Text color="magenta" italic>
                            [Multi-line Input: {lines} lines, {chars} chars]
                        </Text>
                    ) : (
                        <Text>
                            {cursorPos > 0 && query.slice(0, cursorPos)}
                            <Text color="cyan" inverse>{query[cursorPos] || ' '}</Text>
                            {cursorPos < query.length && query.slice(cursorPos + 1)}
                        </Text>
                    )}
                </Box>
                <Box marginTop={0}>
                    <Text color="gray" dimColor>
                        {shouldCollapse
                            ? '[Enter] submit • [Backsp] delete'
                            : '[Enter] send • [Shift+Enter] newline • [\\ + Enter] newline • [/] cmd • [←→↑↓] move'
                        }
                    </Text>
                </Box>
            </Box>
        </Box>
    );
};
