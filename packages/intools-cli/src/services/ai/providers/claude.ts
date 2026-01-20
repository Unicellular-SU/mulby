import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, ChatOptions, AIChatResponse } from './base';
import { AIConfig, AIMessage } from '../../../types/ai';

export class ClaudeProvider extends BaseAIProvider {
    private client: Anthropic;

    constructor(config: AIConfig) {
        super(config);
        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.apiEndpoint, // Optional custom endpoint
            timeout: (config.timeout || 60) * 1000,
        });
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'claude-3-5-sonnet-20241022';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 4096;

        // Convert messages to Anthropic format
        // System message is a top-level parameter in Anthropic API
        const systemMessage = messages.find(m => m.role === 'system');
        const userAssistantMessages = messages.filter(m => m.role !== 'system');

        const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: model,
            messages: userAssistantMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content || '', // Handle null content (blocks?)
                // Anthropic is strict about content blocks for tools, 
                // but simple string content for simple messages.
                // If we have tool outputs, we need to handle block format.
            })) as any,
            max_tokens: maxTokens,
            temperature: options?.temperature,
            system: systemMessage?.content || undefined,
        };

        if (options?.tools && options.tools.length > 0) {
            params.tools = options.tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            }));
        }

        const response = await this.client.messages.create(params);

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
            toolCalls: toolCalls,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens
            }
        };
    }

    async chatStream(messages: AIMessage[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<string> {
        const model = options?.model || this.config.model || 'claude-3-5-sonnet-20241022';
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
            system: systemMessage?.content || undefined,
        });

        let fullContent = '';
        stream.on('text', (text: string) => {
            fullContent += text;
            onChunk(text);
        });

        await stream.finalMessage();
        return fullContent;
    }
}
