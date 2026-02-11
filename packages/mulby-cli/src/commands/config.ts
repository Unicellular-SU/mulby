import chalk from 'chalk';
import { ConfigManager } from '../services/config-manager';

export function configCommand(action: string, key?: string, value?: string) {
    const configManager = ConfigManager.getInstance();

    try {
        switch (action) {
            case 'get':
                if (!key) {
                    console.log(chalk.red('错误: 请指定要查询的配置键，例如: intools config get ai.provider'));
                    return;
                }
                const val = configManager.get(key);
                if (val === undefined) {
                    console.log(chalk.gray('(未设置)'));
                } else {
                    console.log(val);
                }
                break;

            case 'set':
                if (!key || !value) {
                    console.log(chalk.red('错误: 请指定键和值，例如: intools config set ai.apiKey sk-xxx'));
                    return;
                }
                configManager.set(key, value);
                console.log(chalk.green(`✓ 已设置 ${key} = ${value}`));
                break;

            case 'delete':
                if (!key) {
                    console.log(chalk.red('错误: 请指定要删除的配置键'));
                    return;
                }
                configManager.delete(key);
                console.log(chalk.green(`✓ 已删除 ${key}`));
                break;

            case 'list':
                const allConfig = configManager.getAll();
                console.log(JSON.stringify(allConfig, null, 2));
                break;

            default:
                console.log(chalk.red(`错误: 未知操作 '${action}'。支持: get, set, delete, list`));
        }
    } catch (error: any) {
        console.error(chalk.red(`配置操作失败: ${error.message}`));
    }
}
