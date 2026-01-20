
import * as fs from 'fs';
import * as path from 'path';

export function getPluginDevelopGuide(): string {
    try {
        const filePath = path.join(__dirname, 'PLUGIN_DEVELOP_PROMPT.md');
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        // Fallback for dev environment or if file moved
        // Try looking in project root relative to this file
        // this file is in packages/intools-cli/src/services/ai (depth 4 from package, depth 5 from repo root)

        // Try 5 levels up to repo root
        const devPath = path.resolve(__dirname, '../../../../../docs/PLUGIN_DEVELOP_PROMPT.md');
        if (fs.existsSync(devPath)) {
            return fs.readFileSync(devPath, 'utf-8');
        }
    } catch (e) {
        console.warn('Failed to load PLUGIN_DEVELOP_PROMPT.md', e);
    }
    return '';
}



