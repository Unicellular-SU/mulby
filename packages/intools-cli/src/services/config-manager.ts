import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { GlobalConfig } from '../types/ai';

const CONFIG_DIR = path.join(os.homedir(), '.intools');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigManager {
    private static instance: ConfigManager;
    private config: GlobalConfig = {};

    private constructor() {
        this.load();
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    private load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                this.config = fs.readJsonSync(CONFIG_FILE);
            }
        } catch (error) {
            console.error('加载配置文件失败:', error);
            this.config = {};
        }
    }

    public save() {
        try {
            fs.ensureDirSync(CONFIG_DIR);
            fs.writeJsonSync(CONFIG_FILE, this.config, { spaces: 2 });
        } catch (error) {
            console.error('保存配置文件失败:', error);
        }
    }

    public get<T>(key: string): T | undefined {
        const keys = key.split('.');
        let current: any = this.config;

        for (const k of keys) {
            if (current === undefined || current === null) return undefined;
            current = current[k];
        }

        // Automatically convert numeric strings to numbers for specific keys
        if (typeof current === 'string' && (key === 'ai.maxTokens' || key === 'ai.timeout' || key === 'ai.maxRetries')) {
            const num = Number(current);
            return (isNaN(num) ? current : num) as any;
        }

        return current;
    }

    public set(key: string, value: any) {
        const keys = key.split('.');
        let current: any = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (current[k] === undefined) {
                current[k] = {};
            }
            current = current[k];
        }

        current[keys[keys.length - 1]] = value;
        this.save();
    }

    public delete(key: string) {
        const keys = key.split('.');
        let current: any = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (current[k] === undefined) return; // Path doesn't exist
            current = current[k];
        }

        delete current[keys[keys.length - 1]];
        this.save();
    }

    public getAll(): GlobalConfig {
        return { ...this.config };
    }
}
