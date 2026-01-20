import { OpenAIProvider } from './openai';
import { AIConfig } from '../../../types/ai';

export class DeepSeekProvider extends OpenAIProvider {
    constructor(config: AIConfig) {
        // Force deepseek settings if not provided
        const deepseekConfig = {
            ...config,
            provider: 'deepseek' as const, // Ensure provider is set to deepseek for internal logic
            apiEndpoint: config.apiEndpoint || 'https://api.deepseek.com/v1',
            model: config.model || 'deepseek-chat'
        };
        super(deepseekConfig);
    }
}
