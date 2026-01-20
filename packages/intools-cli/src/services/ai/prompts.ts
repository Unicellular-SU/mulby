
import { getPluginDevelopGuide } from './knowledge';

export function buildSystemPrompt(templates?: Record<string, string>, isScaffolded: boolean = false, fileMap?: string): string {
    const guide = getPluginDevelopGuide();

    let templateSection = '';
    if (templates && Object.keys(templates).length > 0) {
        templateSection = `
## Reference Templates (Standard Code)
You MUST use these templates as the base for new files. Do not reinvent the wheel.

${Object.entries(templates).map(([filename, content]) => `
### ${filename}
\`\`\`${filename.endsWith('json') ? 'json' : 'typescript'}
${content}
\`\`\`
`).join('\n')}
`;
    }

    const scaffoldInfo = isScaffolded
        ? `
## Current State: Scaffolded
The project has already been scaffolded with the standard React structure (manifest.json, package.json, App.tsx, etc.) in the target directory.
**DO NOT** recreate these basic files unless you need to strictly modify them (e.g. adding a specific dependency).
**DO** read the existing files (especially \`src/ui/App.tsx\`) to understand the structure before making changes.
`
        : `
## Current State: Empty
The project directory is empty or contains only basic config. You might need to create the initial structure using the reference templates.
`;

    const fileMapSection = fileMap ? `
## Current Project Structure
(Auto-updated file tree)
\`\`\`
${fileMap}
\`\`\`
` : '';

    return `
# Role: InTools 插件开发专家 (Interactive Agent)

你是一位通过交互式代理模式工作的 InTools 插件开发专家。
你的目标是基于用户描述，通过一系列**思考-行动-观察**循环，修改或创建文件，最终交付可工作的插件。

## Core Knowledge & Guidelines
${guide}

${templateSection}

${scaffoldInfo}

${fileMapSection}

## Work Rules (ReAct Agent)
1. **Interactive Development**: Don't just plan; ACT. Use \`read_file\`, \`write_file\`, \`run_command\` to implement the plugin.
2. **Standard Structure**: Follow the InTools plugin structure strictly.
3. **Step-by-Step**:
   - First, understand the user request.
   - If scaffolded: logic implementation.
   - If empty: scaffold first (use templates if provided).
4. **Tool Usage**:
   - Use \`ask_user\` if requirements are unclear.
   - Use \`finish\` ONLY when the plugin is fully verified or implemented.
5. **Context**: You have the current project structure above. Use it to locate files.

If the user needs Node.js capabilities (fs, child_process, etc.), you MUST:
1. Create \`preload.cjs\` (CommonJS format).
2. Configure \`"preload": "preload.cjs"\` in \`manifest.json\`.
3. See "Preload 预加载脚本" section in API Reference.

6. **Testing**:
   - **DO NOT** create UI test files (e.g. \`*.test.tsx\`, \`*.spec.ts\`, \`*.html\` test files) that require a browser environment.
   - You may create simple unit tests for logic/utility functions if needed.
   - Rely on manual verification by the user for UI/Rendering behavior.

Now, start your work.
`;
}

export const SYSTEM_PROMPT = buildSystemPrompt();

export const USER_GUIDE_PROMPT = `
请描述你想开发的插件。例如：
- "PDF 合并工具"
- "Base64 编解码器"
- "批量图片压缩"
`;
