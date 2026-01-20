import { ConfigManager } from '../config-manager';
import { BaseAIProvider } from './providers/base';
import { OpenAIProvider } from './providers/openai';
import { ClaudeProvider } from './providers/claude';
import { DeepSeekProvider } from './providers/deepseek';
import { AIConfig, DEFAULT_AI_CONFIG } from '../../types/ai';

export class AIServiceFactory {
    static create(): BaseAIProvider {
        const configManager = ConfigManager.getInstance();
        const aiConfig = configManager.get<AIConfig>('ai');

        if (!aiConfig || !aiConfig.apiKey) {
            throw new Error('未配置 AI 服务。请使用 `intools config set ai.apiKey <key>` 配置。');
        }

        const mergedConfig = { ...DEFAULT_AI_CONFIG, ...aiConfig } as AIConfig;

        switch (mergedConfig.provider) {
            case 'claude':
                return new ClaudeProvider(mergedConfig);
            case 'deepseek':
                return new DeepSeekProvider(mergedConfig);
            case 'openai':
            case 'custom':
            default:
                return new OpenAIProvider(mergedConfig);
        }
    }
}
