import { ClaudeProvider } from './claude';
import { AIProviderConfig } from '../../../types/ai';

/**
 * MiniMax Provider - 使用 Anthropic SDK 兼容接口
 *
 * 支持模型:
 * - MiniMax-M2.1: 强大多语言编程实力 (200K上下文, 8K输出)
 * - MiniMax-M2.1-lightning: 极速版 (200K上下文, 8K输出)
 * - MiniMax-M2: 基础版 (200K上下文, 8K输出)
 *
 * API 端点: https://api.minimaxi.com/anthropic
 */
export class MiniMaxProvider extends ClaudeProvider {
    constructor(config: AIProviderConfig) {
        const minimaxConfig: AIProviderConfig = {
            ...config,
            provider: 'minimax',
            apiEndpoint: config.apiEndpoint || 'https://api.minimaxi.com/anthropic',
            model: config.model || 'MiniMax-M2.1',
            // 不设置默认值，让 getMaxOutputTokens() 从模型推断
        };
        super(minimaxConfig);
    }
}
