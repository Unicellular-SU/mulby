import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, ChatOptions, AIChatResponse } from './base';
import { AIProviderConfig, AIMessage } from '../../../types/ai';

export class ClaudeProvider extends BaseAIProvider {
    protected client: Anthropic;

    constructor(config: AIProviderConfig) {
        super(config);
        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.apiEndpoint, // Optional custom endpoint
            timeout: (config.timeout || 60) * 1000,
        });
    }

    protected parseXMLToolCalls(content: string): any[] {
        const toolCalls: any[] = [];
        // Regex to match <tool_name>... content ...</tool_name>
        // Use [\s\S]*? for non-greedy match across newlines
        // We look for patterns that look like tool usage
        const toolRegex = /<([a-zA-Z0-9_]+)>\s*\n([\s\S]*?)\n\s*<\/\1>/g;

        let match;
        while ((match = toolRegex.exec(content)) !== null) {
            const toolName = match[1];
            const toolContent = match[2];

            // Skip if it looks like a thinking block or other non-tool tags we know
            if (toolName === 'think' || toolName === 'thought' || toolName === 'thinking') continue;

            // Simple key-value parser for arguments
            // Assumes format: key: "value" or key: value
            const args: Record<string, any> = {};
            const lines = toolContent.split('\n');

            for (const line of lines) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    let value = parts.slice(1).join(':').trim();

                    // Remove quotes if present
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.substring(1, value.length - 1);
                    }

                    if (key && value) {
                        args[key] = value;
                    }
                }
            }

            toolCalls.push({
                id: `call_${Math.random().toString(36).substring(2, 11)}`,
                type: 'function',
                function: {
                    name: toolName,
                    arguments: JSON.stringify(args)
                }
            });
        }

        return toolCalls;
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const model = options?.model || this.config.model || 'claude-3-5-sonnet-20241022';
        let maxTokens = options?.maxTokens || this.config.maxTokens || 8192;

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 8192;

        // Convert messages to Anthropic format
        // System message is a top-level parameter in Anthropic API
        const systemMessage = messages.find(m => m.role === 'system');
        const userAssistantMessages = messages.filter(m => m.role !== 'system');

        const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: model,
            messages: userAssistantMessages.map(m => {
                // Support both string content and content blocks (for cache_control)
                let content: string | any[];
                if (typeof m.content === 'string' || m.content === null) {
                    content = m.content || '';
                } else if (Array.isArray(m.content)) {
                    // Content blocks format - preserve cache_control
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

        const textContent = contentBlock && contentBlock.type === 'text' ? contentBlock.text : null;

        // Fallback: If no structured tool calls, try parsing from text content
        if ((!toolCalls || toolCalls.length === 0) && textContent) {
            const parsedTools = this.parseXMLToolCalls(textContent);
            if (parsedTools.length > 0) {
                toolCalls = parsedTools;
            }
        }

        return {
            content: textContent,
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
            system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
        });

        let fullContent = '';
        stream.on('text', (text: string) => {
            fullContent += text;
            onChunk(text);
        });

        const finalMessage = await stream.finalMessage();

        const thinkingBlock = finalMessage.content.find((c: any) => c.type === 'thinking');
        const toolUseBlocks = finalMessage.content.filter((c: any) => c.type === 'tool_use');

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

        // Try parsing tool calls from the full content if available and no native tool calls found
        if ((!toolCalls || toolCalls.length === 0) && fullContent) {
            const parsedTools = this.parseXMLToolCalls(fullContent);
            if (parsedTools.length > 0) {
                toolCalls = parsedTools;
            }
        }

        return {
            content: fullContent,
            reasoning_content: thinkingBlock && thinkingBlock.type === 'thinking' ? thinkingBlock.thinking : undefined,
            toolCalls: toolCalls
        };
    }
}
