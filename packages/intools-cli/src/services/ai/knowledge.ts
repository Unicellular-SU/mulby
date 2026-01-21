
import * as fs from 'fs';
import * as path from 'path';

export function getPluginDevelopGuide(): string {
    try {
        // 直接从当前目录读取，因为 CLI 会打包发布到 npm
        const filePath = path.join(__dirname, 'PLUGIN_DEVELOP_PROMPT.md');
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        console.warn('PLUGIN_DEVELOP_PROMPT.md not found at:', filePath);
    } catch (e) {
        console.warn('Failed to load PLUGIN_DEVELOP_PROMPT.md', e);
    }
    return '';
}



