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

    /**
     * 将 OpenAI 格式的消息转换为 Anthropic API 格式
     *
     * OpenAI 格式:
     * - { role: 'assistant', content: '...', tool_calls: [...] }
     * - { role: 'tool', tool_call_id: '...', content: '...' }
     *
     * Anthropic 格式:
     * - { role: 'assistant', content: [{ type: 'text', text: '...' }, { type: 'tool_use', id: '...', name: '...', input: {...} }] }
     * - { role: 'user', content: [{ type: 'tool_result', tool_use_id: '...', content: '...' }] }
     */
    protected convertMessagesToAnthropicFormat(messages: AIMessage[]): Anthropic.MessageParam[] {
        const result: Anthropic.MessageParam[] = [];
        let i = 0;

        while (i < messages.length) {
            const msg = messages[i];

            // 跳过 system 消息（会作为顶层参数传递）
            if (msg.role === 'system') {
                i++;
                continue;
            }

            if (msg.role === 'assistant') {
                const contentBlocks: any[] = [];

                // 添加文本内容
                if (msg.content) {
                    const textContent = typeof msg.content === 'string' ? msg.content :
                        (Array.isArray(msg.content) ? msg.content : '');
                    if (typeof textContent === 'string' && textContent.trim()) {
                        contentBlocks.push({ type: 'text', text: textContent });
                    } else if (Array.isArray(textContent)) {
                        // 如果是内容块数组，直接使用
                        contentBlocks.push(...textContent);
                    }
                }

                // 转换 tool_calls 为 tool_use blocks
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    for (const toolCall of msg.tool_calls) {
                        let input: any = {};
                        try {
                            input = typeof toolCall.function.arguments === 'string'
                                ? JSON.parse(toolCall.function.arguments)
                                : toolCall.function.arguments;
                        } catch {
                            input = {};
                        }
                        contentBlocks.push({
                            type: 'tool_use',
                            id: toolCall.id,
                            name: toolCall.function.name,
                            input: input
                        });
                    }
                }

                // 如果没有任何内容，添加空文本
                if (contentBlocks.length === 0) {
                    contentBlocks.push({ type: 'text', text: '' });
                }

                result.push({
                    role: 'assistant',
                    content: contentBlocks
                });
                i++;
            } else if (msg.role === 'tool') {
                // 收集连续的 tool 消息，合并为一个 user 消息
                const toolResultBlocks: any[] = [];

                while (i < messages.length && messages[i].role === 'tool') {
                    const toolMsg = messages[i];
                    toolResultBlocks.push({
                        type: 'tool_result',
                        tool_use_id: toolMsg.tool_call_id,
                        content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
                    });
                    i++;
                }

                result.push({
                    role: 'user',
                    content: toolResultBlocks
                });
            } else if (msg.role === 'user') {
                // 普通 user 消息
                let content: string | any[];
                if (typeof msg.content === 'string' || msg.content === null) {
                    content = msg.content || '';
                } else if (Array.isArray(msg.content)) {
                    content = msg.content;
                } else {
                    content = '';
                }
                result.push({
                    role: 'user',
                    content: content
                });
                i++;
            } else {
                i++;
            }
        }

        return result;
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
        // maxTokens 是最大输出 token 数，使用 getMaxOutputTokens() 获取模型默认值
        let maxTokens = options?.maxTokens || this.config.maxTokens || this.getMaxOutputTokens();

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 8192;  // claude-3-5-sonnet 默认最大输出

        // Convert messages to Anthropic format
        // System message is a top-level parameter in Anthropic API
        const systemMessage = messages.find(m => m.role === 'system');
        const anthropicMessages = this.convertMessagesToAnthropicFormat(messages);

        const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: model,
            messages: anthropicMessages,
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
        // maxTokens 是最大输出 token 数，使用 getMaxOutputTokens() 获取模型默认值
        let maxTokens = options?.maxTokens || this.config.maxTokens || this.getMaxOutputTokens();

        maxTokens = Number(maxTokens);
        if (isNaN(maxTokens)) maxTokens = 8192;  // claude-3-5-sonnet 默认最大输出

        const systemMessage = messages.find(m => m.role === 'system');
        const anthropicMessages = this.convertMessagesToAnthropicFormat(messages);

        const streamParams: any = {
            model: model,
            messages: anthropicMessages,
            max_tokens: maxTokens,
            temperature: options?.temperature,
            system: typeof systemMessage?.content === 'string' ? systemMessage.content : undefined,
        };

        // 添加 tools 参数，确保流式模式下也能使用工具调用
        if (options?.tools && options.tools.length > 0) {
            streamParams.tools = options.tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            }));
        }

        const stream = this.client.messages.stream(streamParams);

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
