import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, ChatOptions, AIChatResponse } from './base';
import { AIProviderConfig, AIMessage } from '../../../types/ai';

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
export class MiniMaxProvider extends BaseAIProvider {
    private client: Anthropic;

    constructor(config: AIProviderConfig) {
        const minimaxConfig: AIProviderConfig = {
            ...config,
            provider: 'minimax',
            apiEndpoint: config.apiEndpoint || 'https://api.minimaxi.com/anthropic',
            model: config.model || 'MiniMax-M2.1'
        };
        super(minimaxConfig);

        this.client = new Anthropic({
            apiKey: minimaxConfig.apiKey,
            baseURL: minimaxConfig.apiEndpoint,
            timeout: (minimaxConfig.timeout || 60) * 1000,
        });
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'MiniMax-M2.1';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 128000;

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 128000;

        // Convert messages to Anthropic format
        // System message is a top-level parameter in Anthropic API
        const systemMessage = messages.find(m => m.role === 'system');
        const userAssistantMessages = messages.filter(m => m.role !== 'system');

        const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: model,
            messages: userAssistantMessages.map(m => {
                // Support both string content and content blocks
                let content: string | any[];
                if (typeof m.content === 'string' || m.content === null) {
                    content = m.content || '';
                } else if (Array.isArray(m.content)) {
                    content = m.content;
                } else {
                    content = '';
                }

                return {
                    role: m.role as 'user' | 'assistant',
                    content: content
                };
            }) as any,
            max_tokens: maxTokens,
            temperature: options?.temperature,
            system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
        };

        if (options?.tools && options.tools.length > 0) {
            params.tools = options.tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            }));
        }

        const response = await this.client.messages.create(params);

        // Handle thinking blocks (MiniMax supports thinking/reasoning)
        const thinkingBlock = response.content.find((c: any) => c.type === 'thinking');
        const contentBlock = response.content.find((c: any) => c.type === 'text');
        const toolUseBlocks = response.content.filter((c: any) => c.type === 'tool_use');

        let toolCalls;
        if (toolUseBlocks.length > 0) {
            toolCalls = toolUseBlocks.map((block: any) => ({
                id: block.id,
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input)
                },
                type: 'function'
            }));
        }

        return {
            content: contentBlock && contentBlock.type === 'text' ? contentBlock.text : null,
            reasoning_content: thinkingBlock && thinkingBlock.type === 'thinking' ? thinkingBlock.thinking : undefined,
            toolCalls: toolCalls,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens
            }
        };
    }

    async chatStream(messages: AIMessage[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'MiniMax-M2.1';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 4096;

        const systemMessage = messages.find(m => m.role === 'system');
        const userAssistantMessages = messages.filter(m => m.role !== 'system');

        const stream = this.client.messages.stream({
            model: model,
            messages: userAssistantMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content || ''
            })) as any,
            max_tokens: maxTokens,
            temperature: options?.temperature,
            system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
        });

        let fullContent = '';
        let reasoningContent = '';

        // Use for-await to iterate stream events
        for await (const event of stream) {
            if (event.type === 'content_block_delta') {
                const delta = event.delta as any;
                if (delta.type === 'thinking_delta' && delta.thinking) {
                    reasoningContent += delta.thinking;
                } else if (delta.type === 'text_delta' && delta.text) {
                    fullContent += delta.text;
                    onChunk(delta.text);
                }
            }
        }

        return {
            content: fullContent,
            reasoning_content: reasoningContent || undefined
        };
    }
}
