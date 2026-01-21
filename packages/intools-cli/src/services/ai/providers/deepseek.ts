import { OpenAIProvider } from './openai';
import { AIProviderConfig } from '../../../types/ai';

/**
 * DeepSeek Provider
 * DeepSeek提供与OpenAI兼容的API接口
 */
export class DeepSeekProvider extends OpenAIProvider {
    constructor(config: AIProviderConfig) {
        // DeepSeek使用OpenAI兼容接口
        const deepseekConfig: AIProviderConfig = {
            ...config,
            provider: 'deepseek',
            apiEndpoint: config.apiEndpoint || 'https://api.deepseek.com',
            model: config.model || 'deepseek-chat'
        };
        super(deepseekConfig);
    }
}
