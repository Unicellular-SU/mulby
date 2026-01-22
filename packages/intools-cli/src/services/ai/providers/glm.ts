import { OpenAIProvider } from './openai';
import { AIProviderConfig } from '../../../types/ai';

/**
 * GLM (智谱AI) Provider
 * 智谱AI提供与OpenAI兼容的API接口
 * 文档: https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
 *
 * 支持模型:
 * - glm-4.7: 最新旗舰模型 (200K上下文, 128K输出)
 * - glm-4.6: 上一代旗舰 (200K上下文, 8K输出)
 * - glm-4-plus/glm-4: 标准模型 (128K上下文, 4K输出)
 * - glm-4-long: 长上下文模型 (1M上下文, 4K输出)
 */
export class GLMProvider extends OpenAIProvider {
    constructor(config: AIProviderConfig) {
        // 智谱AI使用OpenAI兼容接口
        // 注意: maxTokens 是最大输出 token 数，不是上下文窗口
        const glmConfig: AIProviderConfig = {
            ...config,
            provider: 'glm',
            apiEndpoint: config.apiEndpoint || 'https://open.bigmodel.cn/api/paas/v4',
            model: config.model || 'glm-4-plus',
            enableThinking: config.enableThinking ?? true,
            // 不设置默认值，让 getMaxOutputTokens() 从模型推断
        };
        super(glmConfig);
    }
}
