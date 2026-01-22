import { OpenAIProvider } from './openai';
import { AIProviderConfig } from '../../../types/ai';

/**
 * GLM (智谱AI) Provider
 * 智谱AI提供与OpenAI兼容的API接口
 * 文档: https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
 */
export class GLMProvider extends OpenAIProvider {
    constructor(config: AIProviderConfig) {
        // 智谱AI使用OpenAI兼容接口
        const glmConfig: AIProviderConfig = {
            ...config,
            provider: 'glm',
            apiEndpoint: config.apiEndpoint || 'https://open.bigmodel.cn/api/paas/v4',
            model: config.model || 'glm-4.7',
            enableThinking: true,
            maxTokens: config.maxTokens || 128000,
        };
        super(glmConfig);
    }
}
