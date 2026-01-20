export const PLUGIN_GENERATION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the content of a file. Use this to examine existing code or check file status.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Relative path to the file (e.g., package.json, src/ui/App.tsx)' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_in_file',
            description: 'Replace a specific part of a file. Use this for small edits (bug fixes, tweaks) to save tokens. It fails if the target string is not found or found multiple times (unless expected).',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Relative path to the file' },
                    target: { type: 'string', description: 'Exact string to be replaced (must be unique in file)' },
                    replacement: { type: 'string', description: 'New content to replace the target with' }
                },
                required: ['path', 'target', 'replacement']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create or overwrite a file with new content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Relative path to the file' },
                    content: { type: 'string', description: 'Complete content of the file' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a shell command. Use this for installing dependencies (npm install) or other necessary shell operations. Do NOT run long-running processes like "npm run dev".',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The shell command to execute' }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'ask_user',
            description: 'Ask the user a question to clarify requirements or request a decision.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user' }
                },
                required: ['question']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'finish',
            description: 'Mark the task as complete when all requirements are met.',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Summary of what was done and instructions for the user.' }
                },
                required: ['summary']
            }
        }
    }
];
