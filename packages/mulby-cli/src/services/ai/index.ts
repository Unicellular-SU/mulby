import { ConfigManager } from '../config-manager';
import { BaseAIProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { ClaudeProvider } from './providers/claude';
import { DeepSeekProvider } from './providers/deepseek';
import { GeminiProvider } from './providers/gemini';
import { GLMProvider } from './providers/glm';
import { MiniMaxProvider } from './providers/minimax';
import { AIConfig, AIProviderConfig, DEFAULT_PROVIDER_CONFIG } from '../../types/ai';

export class AIServiceFactory {
    /**
     * 创建 AI 服务实例
     * @param providerName 供应商名称，如果不指定则使用默认配置
     * @param modelOverride 临时覆盖模型名称
     */
    static create(providerName?: string, modelOverride?: string): BaseAIProvider {
        const configManager = ConfigManager.getInstance();
        const aiConfig = configManager.get<AIConfig>('ai');

        if (!aiConfig || !aiConfig.providers || Object.keys(aiConfig.providers).length === 0) {
            throw new Error(
                '未配置 AI 服务。请使用 `intools ai add <name>` 添加供应商配置。'
            );
        }

        // 确定使用哪个供应商配置
        const targetProviderName = providerName || aiConfig.default || Object.keys(aiConfig.providers)[0];
        const providerConfig = aiConfig.providers[targetProviderName];

        if (!providerConfig) {
            throw new Error(
                `未找到供应商配置 "${targetProviderName}"。可用的配置: ${Object.keys(aiConfig.providers).join(', ')}`
            );
        }

        // 合并默认配置
        const mergedConfig: AIProviderConfig = {
            ...DEFAULT_PROVIDER_CONFIG,
            ...providerConfig
        };

        // 如果指定了模型覆盖，则使用覆盖的模型
        if (modelOverride) {
            mergedConfig.model = modelOverride;
        }

        // 根据供应商类型创建实例
        return this.createProvider(mergedConfig);
    }

    /**
     * 根据配置创建供应商实例
     */
    private static createProvider(config: AIProviderConfig): BaseAIProvider {
        switch (config.provider) {
            case 'claude':
                return new ClaudeProvider(config);
            case 'deepseek':
                return new DeepSeekProvider(config);
            case 'gemini':
                return new GeminiProvider(config);
            case 'glm':
                return new GLMProvider(config);
            case 'minimax':
                return new MiniMaxProvider(config);
            case 'openai':
            case 'custom':
            default:
                return new OpenAIProvider(config);
        }
    }

    /**
     * 获取所有已配置的供应商列表
     */
    static listProviders(): string[] {
        const configManager = ConfigManager.getInstance();
        const aiConfig = configManager.get<AIConfig>('ai');
        return aiConfig?.providers ? Object.keys(aiConfig.providers) : [];
    }

    /**
     * 获取当前默认供应商名称
     */
    static getDefaultProvider(): string | undefined {
        const configManager = ConfigManager.getInstance();
        const aiConfig = configManager.get<AIConfig>('ai');
        return aiConfig?.default;
    }

    /**
     * 获取指定供应商的配置
     */
    static getProviderConfig(providerName: string): AIProviderConfig | undefined {
        const configManager = ConfigManager.getInstance();
        const aiConfig = configManager.get<AIConfig>('ai');
        return aiConfig?.providers?.[providerName];
    }
}
