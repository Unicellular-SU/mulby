import { ClaudeProvider } from './claude';
import { AIProviderConfig } from '../../../types/ai';

/**
 * MiniMax Provider - 使用 Anthropic SDK 兼容接口
 *
 * 支持模型:
 * - MiniMax-M2.1: 强大多语言编程实力 (输出速度约60tps)
 * - MiniMax-M2.1-lightning: 极速版，更快更敏捷 (输出速度约100tps)
 * - MiniMax-M2: 专为高效编码与Agent工作流而生
 *
 * API 端点: https://api.minimaxi.com/anthropic
 */
export class MiniMaxProvider extends ClaudeProvider {
    constructor(config: AIProviderConfig) {
        const minimaxConfig: AIProviderConfig = {
            ...config,
            provider: 'minimax',
            apiEndpoint: config.apiEndpoint || 'https://api.minimaxi.com/anthropic',
            model: config.model || 'MiniMax-M2.1'
        };
        super(minimaxConfig);
    }
}
