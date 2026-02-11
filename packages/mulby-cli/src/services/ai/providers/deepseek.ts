import { OpenAIProvider } from './openai';
import { AIProviderConfig } from '../../../types/ai';

/**
 * DeepSeek Provider
 * DeepSeek提供与OpenAI兼容的API接口
 *
 * 支持模型:
 * - deepseek-chat: V3/V3.1 通用对话模型 (64K上下文, 8K输出)
 * - deepseek-reasoner: R1 推理模型 (64K上下文, 32K输出)
 */
export class DeepSeekProvider extends OpenAIProvider {
    constructor(config: AIProviderConfig) {
        // DeepSeek使用OpenAI兼容接口
        // 注意: maxTokens 是最大输出 token 数，不是上下文窗口
        const deepseekConfig: AIProviderConfig = {
            ...config,
            provider: 'deepseek',
            apiEndpoint: config.apiEndpoint || 'https://api.deepseek.com',
            model: config.model || 'deepseek-chat',
            // deepseek-chat 默认最大输出 8K，deepseek-reasoner 可达 32K
            // 不设置默认值，让 getMaxOutputTokens() 从模型推断
        };
        super(deepseekConfig);
    }
}
