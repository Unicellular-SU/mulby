import OpenAI from 'openai';
import { BaseAIProvider, ChatOptions, AIChatResponse } from './base';
import { AIConfig, AIMessage } from '../../../types/ai';

export class OpenAIProvider extends BaseAIProvider {
    private client: OpenAI;

    constructor(config: AIConfig) {
        super(config);
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiEndpoint || this.getBaseURL(config.provider),
            timeout: (config.timeout || 60) * 1000,
        });
    }

    private getBaseURL(provider: string): string | undefined {
        switch (provider) {
            case 'deepseek':
                return 'https://api.deepseek.com/v1';
            default:
                return undefined;
        }
    }

    private getDefaultModel(provider: string): string {
        switch (provider) {
            case 'deepseek':
                return 'deepseek-chat';
            default:
                return 'gpt-4o';
        }
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || this.getDefaultModel(this.config.provider);
        let maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        // Final safety cast to number
        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 4096;

        const response = await this.client.chat.completions.create({
            model: model,
            messages: messages as any, // Type casting for compatibility
            temperature: options?.temperature,
            max_tokens: maxTokens,
            tools: options?.tools,
            tool_choice: options?.toolChoice,
            stream: false,
        });

        const choice = response.choices[0];
        const message = choice.message;
        let content = message.content;

        // DeepSeek reasoning support
        if ((message as any).reasoning_content) {
            const thinking = (message as any).reasoning_content;
            content = `<think>\n${thinking}\n</think>\n\n${content || ''}`;
        }

        return {
            content: content,
            toolCalls: message.tool_calls,
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
            } : undefined
        };
    }

    async chatStream(messages: AIMessage[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<string> {
        const model = options?.model || this.config.model || this.getDefaultModel(this.config.provider);
        let maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        // Final safety cast to number
        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 4096;

        const stream = await this.client.chat.completions.create({
            model: model,
            messages: messages as any,
            temperature: options?.temperature,
            max_tokens: maxTokens,
            stream: true,
        });

        let fullContent = '';
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullContent += content;
                onChunk(content);
            }
        }
        return fullContent;
    }
}
