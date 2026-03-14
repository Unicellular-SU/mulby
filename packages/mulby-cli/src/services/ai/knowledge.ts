import * as fs from 'fs';
import * as path from 'path';

export function getPluginDevelopGuide(): string {
    try {
        const basePath = findUp(__dirname, 'PLUGIN_DEVELOP_PROMPT.md');
        const appendixPath = path.join(__dirname, 'PLUGIN_DEVELOP_AI_APPENDIX.md');
        const parts: string[] = [];

        if (basePath && fs.existsSync(basePath)) {
            parts.push(fs.readFileSync(basePath, 'utf-8'));
        } else {
            console.warn('PLUGIN_DEVELOP_PROMPT.md not found from:', __dirname);
        }

        if (fs.existsSync(appendixPath)) {
            parts.push(fs.readFileSync(appendixPath, 'utf-8'));
        } else {
            console.warn('PLUGIN_DEVELOP_AI_APPENDIX.md not found at:', appendixPath);
        }

        return parts.filter(Boolean).join('\n\n');
    } catch (e) {
        console.warn('Failed to load plugin development guide', e);
    }
    return '';
}

function findUp(startDir: string, filename: string): string | null {
    let current = path.resolve(startDir);

    while (true) {
        const candidate = path.join(current, filename);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
