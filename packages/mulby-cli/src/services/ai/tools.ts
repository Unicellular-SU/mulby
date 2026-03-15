export const PLUGIN_GENERATION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the content of a file. Use this to examine project files or bundled skill files under @skills/<skill-id>/....',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Project-relative file path or read-only bundled skill path such as @skills/develop-mulby-plugin/SKILL.md' }
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
            description: 'Ask the user a question to clarify requirements or request a decision. Use this frequently during the Product Consultant phase.',
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
            name: 'scaffold_project',
            description: 'Create the project scaffold (React + Vite template). Call this ONLY after you have confirmed requirements with the user in the Product Consultant phase. This will generate: package.json, manifest.json, vite.config.ts, src/ui/App.tsx, etc.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Reason for creating scaffold (e.g., "Requirements confirmed: image stitching tool with drag-drop UI")' }
                },
                required: ['reason']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List files and directories in a specific path. Use this to explore the project structure or bundled skills under @skills/<skill-id>/....',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Project-relative directory or bundled skill path such as @skills/develop-mulby-plugin/references' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a string or pattern in files. Useful for finding code snippets in the project or bundled skill references.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'String or Regex to search for' },
                    path: { type: 'string', description: 'Project-relative directory or bundled skill path (default: ".")' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file_outline',
            description: 'Read the outline (symbols, functions, classes) of a file without reading the full content. Works for project files and bundled skill files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Project-relative file path or bundled skill file path' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file or directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Relative path to delete' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'move_file',
            description: 'Move or rename a file.',
            parameters: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Current path' },
                    destination: { type: 'string', description: 'New path' }
                },
                required: ['source', 'destination']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch content from a URL to read documentation or external data (converts to Markdown/Text).',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to fetch' }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_types',
            description: 'Run TypeScript compiler to check for type errors.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'validate_plugin',
            description: 'Validate Mulby plugin integration before finish. Checks manifest.json, feature configuration, entry files, preload conventions, and optionally runs npm run build. You MUST call this and fix all errors before finish.',
            parameters: {
                type: 'object',
                properties: {
                    runBuild: {
                        type: 'boolean',
                        description: 'Whether to run npm run build during validation. Default true.'
                    }
                },
                required: []
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
