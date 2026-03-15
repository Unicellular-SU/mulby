import * as fs from 'fs';
import * as path from 'path';
import { buildBundledSkillBootstrapPrompt } from './bundled-skills';

export function getPluginDevelopGuide(): string {
    try {
        const appendixPath = path.join(__dirname, 'PLUGIN_DEVELOP_AI_APPENDIX.md');
        const parts: string[] = [];

        parts.push(buildBundledSkillBootstrapPrompt());

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
