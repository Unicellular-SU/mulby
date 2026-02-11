
import * as fs from 'fs-extra';
import * as path from 'path';

export class FileWriter {
    constructor(private basePath: string) { }

    public async writeFile(relativePath: string, content: string): Promise<void> {
        this.validatePath(relativePath);

        const fullPath = path.join(this.basePath, relativePath);
        await fs.ensureDir(path.dirname(fullPath));

        // 简单的原子写入模拟：写 .tmp -> rename
        const tmpPath = `${fullPath}.tmp`;
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.move(tmpPath, fullPath, { overwrite: true });
    }

    private validatePath(relativePath: string) {
        const fullPath = path.resolve(this.basePath, relativePath);
        if (!fullPath.startsWith(path.resolve(this.basePath))) {
            throw new Error(`非法路径尝试: ${relativePath}`);
        }
    }

    public async exists(relativePath: string): Promise<boolean> {
        const fullPath = path.join(this.basePath, relativePath);
        return fs.pathExists(fullPath);
    }

    public getBasePath() {
        return this.basePath;
    }
}
