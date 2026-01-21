import { BaseAIProvider, AIChatResponse, ChatOptions } from './base';
import { AIMessage, AIProviderConfig } from '../../../types/ai';

interface GeminiMessage {
    role: 'user' | 'model';
    parts: Array<{ text: string } | { functionCall?: any; functionResponse?: any }>;
}

interface GeminiTool {
    functionDeclarations: Array<{
        name: string;
        description: string;
        parameters: any;
    }>;
}

export class GeminiProvider extends BaseAIProvider {
    private apiKey: string;
    private baseURL: string;
    private model: string;

    constructor(config: AIProviderConfig) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseURL = config.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta';
        this.model = config.model || 'gemini-2.0-flash-exp';
    }

    async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse> {
        const { contents, systemInstruction } = this.convertMessages(messages);
        const tools = options?.tools ? this.convertTools(options.tools) : undefined;

        const requestBody: any = {
            contents,
            generationConfig: {
                maxOutputTokens: this.config.maxTokens,
                temperature: 0.7,
            }
        };

        if (systemInstruction) {
            requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        if (tools) {
            requestBody.tools = [tools];
        }

        const url = `${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini API error: ${response.status} ${error}`);
        }

        const data = await response.json();
        return this.parseResponse(data);
    }

    async chatStream(
        messages: AIMessage[],
        onChunk: (chunk: string) => void,
        options?: ChatOptions
    ): Promise<string> {
        const { contents, systemInstruction } = this.convertMessages(messages);
        const tools = options?.tools ? this.convertTools(options.tools) : undefined;

        const requestBody: any = {
            contents,
            generationConfig: {
                maxOutputTokens: this.config.maxTokens,
                temperature: 0.7,
            }
        };

        if (systemInstruction) {
            requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        if (tools) {
            requestBody.tools = [tools];
        }

        const url = `${this.baseURL}/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini API error: ${response.status} ${error}`);
        }

        let fullContent = '';
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
            throw new Error('Response body is not readable');
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) {
                            fullContent += text;
                            onChunk(text);
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }

        return fullContent;
    }

    private convertMessages(messages: AIMessage[]): { contents: GeminiMessage[]; systemInstruction?: string } {
        let systemInstruction: string | undefined;
        const contents: GeminiMessage[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemInstruction = msg.content || '';
                continue;
            }

            if (msg.role === 'tool') {
                // 工具响应
                const lastMessage = contents[contents.length - 1];
                if (lastMessage && lastMessage.role === 'model') {
                    lastMessage.parts.push({
                        functionResponse: {
                            name: msg.name,
                            response: {
                                content: msg.content
                            }
                        }
                    });
                }
                continue;
            }

            const role = msg.role === 'assistant' ? 'model' : 'user';
            const parts: any[] = [];

            if (msg.content) {
                parts.push({ text: msg.content });
            }

            if (msg.tool_calls) {
                for (const toolCall of msg.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: JSON.parse(toolCall.function.arguments)
                        }
                    });
                }
            }

            contents.push({ role, parts });
        }

        return { contents, systemInstruction };
    }

    private convertTools(tools: any[]): GeminiTool {
        return {
            functionDeclarations: tools.map(tool => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters
            }))
        };
    }

    private parseResponse(data: any): AIChatResponse {
        const candidate = data.candidates?.[0];
        if (!candidate) {
            return { content: null };
        }

        const parts = candidate.content?.parts || [];
        let content = '';
        const toolCalls: any[] = [];

        for (const part of parts) {
            if (part.text) {
                content += part.text;
            }
            if (part.functionCall) {
                toolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'function',
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args)
                    }
                });
            }
        }

        return {
            content: content || null,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: data.usageMetadata ? {
                promptTokens: data.usageMetadata.promptTokenCount || 0,
                completionTokens: data.usageMetadata.candidatesTokenCount || 0,
                totalTokens: data.usageMetadata.totalTokenCount || 0
            } : undefined
        };
    }
}
