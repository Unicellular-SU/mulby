import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager } from '../services/config-manager';
import {
    AIConfig,
    AIProviderConfig,
    AIProviderType,
    PROVIDER_MODELS,
    PROVIDER_ENDPOINTS
} from '../types/ai';

export function createAIConfigCommand() {
    const command = new Command('ai')
        .description('管理 AI 供应商配置');

    // 添加供应商配置
    command
        .command('add <name>')
        .description('添加新的 AI 供应商配置')
        .option('-p, --provider <provider>', '供应商类型 (openai/claude/deepseek/gemini/glm/custom)')
        .option('-k, --api-key <key>', 'API Key')
        .option('-m, --model <model>', '模型名称')
        .option('-e, --endpoint <url>', 'API 端点 (可选)')
        .action(async (name: string, options) => {
            try {
                const configManager = ConfigManager.getInstance();
                let aiConfig = configManager.get<AIConfig>('ai') || { providers: {} };

                // 如果配置已存在，询问是否覆盖
                if (aiConfig.providers[name]) {
                    const { confirm } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'confirm',
                        message: `配置 "${name}" 已存在，是否覆盖？`,
                        default: false
                    }]);
                    if (!confirm) {
                        console.log(chalk.yellow('已取消'));
                        return;
                    }
                }

                // 交互式收集配置
                let provider: AIProviderType = options.provider;
                let apiKey: string = options.apiKey;
                let model: string | undefined = options.model;
                let endpoint: string | undefined = options.endpoint;

                if (!provider) {
                    const { selectedProvider } = await inquirer.prompt([{
                        type: 'list',
                        name: 'selectedProvider',
                        message: '选择 AI 供应商:',
                        choices: [
                            { name: 'OpenAI', value: 'openai' },
                            { name: 'Claude (Anthropic)', value: 'claude' },
                            { name: 'DeepSeek', value: 'deepseek' },
                            { name: 'Gemini (Google)', value: 'gemini' },
                            { name: 'GLM (智谱AI)', value: 'glm' },
                            { name: 'Custom (自定义)', value: 'custom' }
                        ]
                    }]);
                    provider = selectedProvider;
                }

                if (!apiKey) {
                    const { inputKey } = await inquirer.prompt([{
                        type: 'password',
                        name: 'inputKey',
                        message: '输入 API Key:',
                        validate: (input) => input.length > 0 || 'API Key 不能为空'
                    }]);
                    apiKey = inputKey;
                }

                // 选择模型
                if (!model && PROVIDER_MODELS[provider].length > 0) {
                    const { selectedModel } = await inquirer.prompt([{
                        type: 'list',
                        name: 'selectedModel',
                        message: '选择模型:',
                        choices: PROVIDER_MODELS[provider],
                        default: PROVIDER_MODELS[provider][0]
                    }]);
                    model = selectedModel;
                }

                // 自定义端点
                if (!endpoint && provider === 'custom') {
                    const { inputEndpoint } = await inquirer.prompt([{
                        type: 'input',
                        name: 'inputEndpoint',
                        message: '输入 API 端点:',
                        validate: (input) => input.length > 0 || 'API 端点不能为空'
                    }]);
                    endpoint = inputEndpoint;
                } else if (!endpoint) {
                    endpoint = PROVIDER_ENDPOINTS[provider];
                }

                // 保存配置
                const providerConfig: AIProviderConfig = {
                    provider,
                    apiKey,
                    model,
                    apiEndpoint: endpoint
                };

                aiConfig.providers[name] = providerConfig;

                // 如果是第一个配置，设为默认
                if (!aiConfig.default) {
                    aiConfig.default = name;
                }

                configManager.set('ai', aiConfig);
                console.log(chalk.green(`✓ 已添加配置 "${name}"`));

                if (aiConfig.default === name) {
                    console.log(chalk.blue(`  已设为默认配置`));
                }
            } catch (error: any) {
                console.error(chalk.red('添加配置失败:'), error.message);
            }
        });

    // 列出所有配置
    command
        .command('list')
        .alias('ls')
        .description('列出所有 AI 供应商配置')
        .action(() => {
            try {
                const configManager = ConfigManager.getInstance();
                const aiConfig = configManager.get<AIConfig>('ai');

                if (!aiConfig || !aiConfig.providers || Object.keys(aiConfig.providers).length === 0) {
                    console.log(chalk.yellow('未配置任何 AI 供应商'));
                    console.log(chalk.gray('使用 `mulby ai add <name>` 添加配置'));
                    return;
                }

                console.log(chalk.bold('\nAI 供应商配置:\n'));

                for (const [name, config] of Object.entries(aiConfig.providers)) {
                    const isDefault = aiConfig.default === name;
                    const prefix = isDefault ? chalk.green('● ') : '  ';
                    const suffix = isDefault ? chalk.gray(' (默认)') : '';

                    console.log(`${prefix}${chalk.bold(name)}${suffix}`);
                    console.log(`  ${chalk.gray('供应商:')} ${config.provider}`);
                    console.log(`  ${chalk.gray('模型:')} ${config.model || '未指定'}`);
                    console.log(`  ${chalk.gray('API Key:')} ${maskApiKey(config.apiKey)}`);
                    if (config.apiEndpoint) {
                        console.log(`  ${chalk.gray('端点:')} ${config.apiEndpoint}`);
                    }
                    console.log();
                }
            } catch (error: any) {
                console.error(chalk.red('列出配置失败:'), error.message);
            }
        });

    // 删除配置
    command
        .command('remove <name>')
        .alias('rm')
        .description('删除 AI 供应商配置')
        .action(async (name: string) => {
            try {
                const configManager = ConfigManager.getInstance();
                const aiConfig = configManager.get<AIConfig>('ai');

                if (!aiConfig || !aiConfig.providers || !aiConfig.providers[name]) {
                    console.log(chalk.yellow(`配置 "${name}" 不存在`));
                    return;
                }

                const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `确定要删除配置 "${name}"？`,
                    default: false
                }]);

                if (!confirm) {
                    console.log(chalk.yellow('已取消'));
                    return;
                }

                delete aiConfig.providers[name];

                // 如果删除的是默认配置，重新设置默认
                if (aiConfig.default === name) {
                    const remainingProviders = Object.keys(aiConfig.providers);
                    aiConfig.default = remainingProviders.length > 0 ? remainingProviders[0] : undefined;
                }

                configManager.set('ai', aiConfig);
                console.log(chalk.green(`✓ 已删除配置 "${name}"`));

                if (aiConfig.default) {
                    console.log(chalk.blue(`  默认配置已切换为 "${aiConfig.default}"`));
                }
            } catch (error: any) {
                console.error(chalk.red('删除配置失败:'), error.message);
            }
        });

    // 设置默认配置
    command
        .command('use <name>')
        .description('设置默认使用的 AI 供应商配置')
        .action((name: string) => {
            try {
                const configManager = ConfigManager.getInstance();
                const aiConfig = configManager.get<AIConfig>('ai');

                if (!aiConfig || !aiConfig.providers || !aiConfig.providers[name]) {
                    console.log(chalk.yellow(`配置 "${name}" 不存在`));
                    console.log(chalk.gray('使用 `mulby ai list` 查看所有配置'));
                    return;
                }

                aiConfig.default = name;
                configManager.set('ai', aiConfig);
                console.log(chalk.green(`✓ 已将 "${name}" 设为默认配置`));
            } catch (error: any) {
                console.error(chalk.red('设置默认配置失败:'), error.message);
            }
        });

    // 查看配置详情
    command
        .command('show <name>')
        .description('查看指定 AI 供应商配置的详细信息')
        .action((name: string) => {
            try {
                const configManager = ConfigManager.getInstance();
                const aiConfig = configManager.get<AIConfig>('ai');

                if (!aiConfig || !aiConfig.providers || !aiConfig.providers[name]) {
                    console.log(chalk.yellow(`配置 "${name}" 不存在`));
                    return;
                }

                const config = aiConfig.providers[name];
                const isDefault = aiConfig.default === name;

                console.log(chalk.bold(`\n配置: ${name}`) + (isDefault ? chalk.gray(' (默认)') : ''));
                console.log(chalk.gray('─'.repeat(50)));
                console.log(`${chalk.gray('供应商:')} ${config.provider}`);
                console.log(`${chalk.gray('模型:')} ${config.model || '未指定'}`);
                console.log(`${chalk.gray('API Key:')} ${maskApiKey(config.apiKey)}`);
                if (config.apiEndpoint) {
                    console.log(`${chalk.gray('端点:')} ${config.apiEndpoint}`);
                }
                console.log(`${chalk.gray('最大重试:')} ${config.maxRetries || 3}`);
                console.log(`${chalk.gray('超时时间:')} ${config.timeout || 60}s`);
                console.log(`${chalk.gray('流式输出:')} ${config.streaming !== false ? '是' : '否'}`);
                if (config.maxTokens) {
                    console.log(`${chalk.gray('最大 Token:')} ${config.maxTokens}`);
                }
                console.log();
            } catch (error: any) {
                console.error(chalk.red('查看配置失败:'), error.message);
            }
        });

    // 更新配置
    command
        .command('update <name>')
        .description('更新 AI 供应商配置')
        .option('-k, --api-key <key>', '更新 API Key')
        .option('-m, --model <model>', '更新模型名称')
        .option('-e, --endpoint <url>', '更新 API 端点')
        .action(async (name: string, options) => {
            try {
                const configManager = ConfigManager.getInstance();
                const aiConfig = configManager.get<AIConfig>('ai');

                if (!aiConfig || !aiConfig.providers || !aiConfig.providers[name]) {
                    console.log(chalk.yellow(`配置 "${name}" 不存在`));
                    return;
                }

                const config = aiConfig.providers[name];
                let updated = false;

                if (options.apiKey) {
                    config.apiKey = options.apiKey;
                    updated = true;
                }

                if (options.model) {
                    config.model = options.model;
                    updated = true;
                }

                if (options.endpoint) {
                    config.apiEndpoint = options.endpoint;
                    updated = true;
                }

                if (!updated) {
                    console.log(chalk.yellow('未指定要更新的字段'));
                    console.log(chalk.gray('使用 --api-key, --model 或 --endpoint 选项'));
                    return;
                }

                configManager.set('ai', aiConfig);
                console.log(chalk.green(`✓ 已更新配置 "${name}"`));
            } catch (error: any) {
                console.error(chalk.red('更新配置失败:'), error.message);
            }
        });

    return command;
}

function maskApiKey(key: string): string {
    if (key.length <= 8) {
        return '***';
    }
    return key.substring(0, 4) + '***' + key.substring(key.length - 4);
}
