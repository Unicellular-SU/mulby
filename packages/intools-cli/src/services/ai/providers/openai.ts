import OpenAI from 'openai';
import { BaseAIProvider, ChatOptions, AIChatResponse } from './base';
import { AIProviderConfig, AIMessage } from '../../../types/ai';

export class OpenAIProvider extends BaseAIProvider {
    private client: OpenAI;

    constructor(config: AIProviderConfig) {
        super(config);
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiEndpoint,
            timeout: (config.timeout || 60) * 1000,
        });
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'gpt-4o';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 128000;

        // Final safety cast to number
        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 128000;

        const requestOptions: any = {
            model: model,
            messages: messages as any, // Type casting for compatibility
            temperature: options?.temperature,
            max_tokens: maxTokens,
            tools: options?.tools,
            tool_choice: options?.toolChoice,
            stream: false,
        };

        if (options?.enableThinking || this.config.enableThinking) {
            requestOptions.extra_body = {
                thinking: {
                    type: "enabled",
                },
            };
        }

        const response = await this.client.chat.completions.create(requestOptions);

        const choice = response.choices[0];
        const message = choice.message;
        let content = message.content;

        // DeepSeek & GLM reasoning support
        let reasoningContent: string | undefined;
        if ((message as any).reasoning_content) {
            reasoningContent = (message as any).reasoning_content;
            // Removed: content = `<think>\n${thinking}\n</think>\n\n${content || ''}`;
            // We now keep content clean and return reasoning_content separately
        }

        return {
            content: content,
            reasoning_content: reasoningContent,
            toolCalls: message.tool_calls,
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
            } : undefined
        };
    }

    async chatStream(messages: AIMessage[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'gpt-4o';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        // Final safety cast to number
        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 4096;

        const requestOptions: any = {
            model: model,
            messages: messages as any,
            temperature: options?.temperature,
            max_tokens: maxTokens,
            tools: options?.tools,
            tool_choice: options?.toolChoice,
            stream: true,
            stream_options: { include_usage: true }
        };

        if (options?.enableThinking || this.config.enableThinking) {
            requestOptions.extra_body = {
                thinking: {
                    type: "enabled",
                },
            };
        }

        const stream = await this.client.chat.completions.create(requestOptions) as any;

        let cleanContent = '';
        let reasoningContent = '';
        const toolCallsMap: Record<number, any> = {};

        let hasStartedThinking = false;
        let hasEndedThinking = false;
        let finalUsage: any = undefined;

        for await (const chunk of stream) {
            if (chunk.usage) {
                finalUsage = chunk.usage;
            }

            const choices = chunk.choices || [];
            if (choices.length === 0) continue;

            const delta = choices[0].delta as any;

            // Handle reasoning content (GLM/DeepSeek)
            if (delta?.reasoning_content) {
                if (!hasStartedThinking) {
                    const startTag = '<think>\n';
                    onChunk(startTag);
                    hasStartedThinking = true;
                }
                const reasoning = delta.reasoning_content;
                reasoningContent += reasoning;
                onChunk(reasoning);
                continue;
            }

            // Close thinking tag if we switch to normal content or tools
            if (hasStartedThinking && !hasEndedThinking && (delta?.content || delta?.tool_calls)) {
                const endTag = '\n</think>\n\n';
                onChunk(endTag);
                hasEndedThinking = true;
            }

            // Handle Content
            const content = delta?.content || '';
            if (content) {
                cleanContent += content;
                onChunk(content);
            }

            // Handle Tool Calls
            if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index;
                    if (!toolCallsMap[index]) {
                        toolCallsMap[index] = {
                            id: toolCall.id || '',
                            type: toolCall.type || 'function',
                            function: {
                                name: toolCall.function?.name || '',
                                arguments: toolCall.function?.arguments || ''
                            }
                        };
                    } else {
                        // Append arguments
                        if (toolCall.function?.arguments) {
                            toolCallsMap[index].function.arguments += toolCall.function.arguments;
                        }
                    }
                }
            }
        }

        // Ensure thinking tag is closed if stream ends just after reasoning
        if (hasStartedThinking && !hasEndedThinking) {
            const endTag = '\n</think>\n\n';
            onChunk(endTag);
            hasEndedThinking = true;
        }

        const toolCalls = Object.values(toolCallsMap).map((tc: any) => ({
            id: tc.id,
            type: tc.type,
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments // Keep as string, caller parses it
            }
        }));

        return {
            content: cleanContent,
            reasoning_content: reasoningContent || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: finalUsage ? {
                promptTokens: finalUsage.prompt_tokens,
                completionTokens: finalUsage.completion_tokens,
                totalTokens: finalUsage.total_tokens
            } : undefined
        };
    }
}
