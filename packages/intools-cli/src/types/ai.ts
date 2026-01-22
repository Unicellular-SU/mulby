// 支持的 AI 供应商类型
export type AIProviderType = 'openai' | 'claude' | 'deepseek' | 'gemini' | 'glm' | 'minimax' | 'custom';

// 单个供应商配置
export interface AIProviderConfig {
    provider: AIProviderType;
    apiKey: string;
    apiEndpoint?: string;    // 自定义端点
    model?: string;          // 模型选择

    // 高级配置
    maxRetries?: number;     // 最大重试次数，默认 3
    timeout?: number;        // 超时时间（秒），默认 60
    maxTokens?: number;      // 最大输出 token 数
    contextWindow?: number;  // 上下文窗口大小（输入+输出总限制）
    streaming?: boolean;     // 是否流式输出，默认 true
    enableThinking?: boolean; // 是否启用思考/推理能力 (如 GLM-4.7, DeepSeek R1)
}

// 多供应商配置结构
export interface AIConfig {
    default?: string;        // 默认使用的配置名称
    providers: {
        [name: string]: AIProviderConfig;
    };
}

export interface GlobalConfig {
    ai?: AIConfig;
    [key: string]: any;
}

export const DEFAULT_PROVIDER_CONFIG: Partial<AIProviderConfig> = {
    maxRetries: 3,
    timeout: 60,
    streaming: true
};

// 预设的供应商模型 (2026年1月最新)
// 注意: maxTokens 在 OpenAI/Anthropic SDK 中都表示"最大输出 token 数"
export const PROVIDER_MODELS: Record<AIProviderType, string[]> = {
    openai: [
        // GPT-5.2 系列 (2026年最新, 400K上下文)
        'gpt-5.2', 'gpt-5.2-pro', 'gpt-5.2-chat-latest',
        // GPT-5.1 系列
        'gpt-5.1', 'gpt-5.1-mini',
        // GPT-5 系列
        'gpt-5', 'gpt-5-mini',
        // o 系列推理模型
        'o3', 'o3-mini', 'o4-mini',
    ],
    claude: [
        // Claude 4.5 系列 (2025年最新)
        'claude-opus-4-5-20250514', 'claude-sonnet-4-5-20250514',
        // Claude 4 系列
        'claude-sonnet-4-20250514',
        // Claude 3.5 系列 (仍然广泛使用)
        'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    ],
    deepseek: [
        // DeepSeek V3.1 (2025年8月)
        'deepseek-chat',      // V3/V3.1
        'deepseek-reasoner',  // R1 推理模型
    ],
    gemini: [
        // Gemini 3 系列 (2026年最新)
        'gemini-3-pro-preview', 'gemini-3-flash-preview',
        // Gemini 2.5 系列
        'gemini-2.5-pro', 'gemini-2.5-flash',
        // Gemini 2.0 系列
        'gemini-2.0-flash',
    ],
    glm: [
        // GLM 4.7 (2025年最新)
        'glm-4.7', 'glm-4.6',
        // GLM 4 系列
        'glm-4-plus', 'glm-4', 'glm-4-air', 'glm-4-flash', 'glm-4-long',
    ],
    minimax: [
        // MiniMax M2 系列 (2025年12月)
        'MiniMax-M2.1', 'MiniMax-M2.1-lightning', 'MiniMax-M2',
    ],
    custom: []
};

// 模型上下文窗口信息
export interface ModelInfo {
    contextWindow: number;  // 上下文窗口大小
    maxOutput?: number;     // 推荐的最大输出 token 数
}

// 各供应商模型的上下文窗口配置 (2026年1月最新)
// contextWindow: 上下文窗口大小 (输入+输出总限制)
// maxOutput: 最大输出 token 数 (OpenAI/Anthropic SDK 中 max_tokens 参数的值)
export const MODEL_CONTEXT_WINDOWS: Record<string, ModelInfo> = {
    // ============ OpenAI ============
    // GPT-5.2 系列 (2026年最新, 400K上下文)
    'gpt-5.2': { contextWindow: 400000, maxOutput: 128000 },
    'gpt-5.2-pro': { contextWindow: 400000, maxOutput: 128000 },
    'gpt-5.2-chat-latest': { contextWindow: 128000, maxOutput: 16384 },
    // GPT-5.1 系列
    'gpt-5.1': { contextWindow: 400000, maxOutput: 128000 },
    'gpt-5.1-mini': { contextWindow: 128000, maxOutput: 32768 },
    // GPT-5 系列
    'gpt-5': { contextWindow: 400000, maxOutput: 128000 },
    'gpt-5-mini': { contextWindow: 128000, maxOutput: 32768 },
    // o 系列推理模型
    'o3': { contextWindow: 200000, maxOutput: 100000 },
    'o3-mini': { contextWindow: 200000, maxOutput: 100000 },
    'o4-mini': { contextWindow: 200000, maxOutput: 100000 },
    // 旧模型 (兼容)
    'gpt-4o': { contextWindow: 128000, maxOutput: 16384 },
    'gpt-4o-mini': { contextWindow: 128000, maxOutput: 16384 },
    'gpt-4': { contextWindow: 128000, maxOutput: 8192 },
    'gpt-4-turbo': { contextWindow: 128000, maxOutput: 4096 },

    // ============ Claude (Anthropic) ============
    // Claude 4.5 系列 (2025年最新)
    'claude-opus-4-5-20250514': { contextWindow: 200000, maxOutput: 32000 },
    'claude-sonnet-4-5-20250514': { contextWindow: 200000, maxOutput: 16000 },
    // Claude 4 系列
    'claude-sonnet-4-20250514': { contextWindow: 200000, maxOutput: 64000 },
    // Claude 3.5 系列
    'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutput: 8192 },
    'claude-3-5-haiku-20241022': { contextWindow: 200000, maxOutput: 8192 },
    // Claude 别名 (用于前缀匹配)
    'claude-opus-4-5': { contextWindow: 200000, maxOutput: 32000 },
    'claude-sonnet-4-5': { contextWindow: 200000, maxOutput: 16000 },
    'claude-sonnet-4': { contextWindow: 200000, maxOutput: 64000 },
    'claude-3-5-sonnet': { contextWindow: 200000, maxOutput: 8192 },
    'claude-3-5-haiku': { contextWindow: 200000, maxOutput: 8192 },

    // ============ DeepSeek ============
    'deepseek-chat': { contextWindow: 65536, maxOutput: 8192 },
    'deepseek-reasoner': { contextWindow: 65536, maxOutput: 32768 },

    // ============ Gemini (Google) ============
    // Gemini 3 系列 (2026年最新)
    'gemini-3-pro-preview': { contextWindow: 1000000, maxOutput: 65536 },
    'gemini-3-flash-preview': { contextWindow: 1000000, maxOutput: 32768 },
    // Gemini 2.5 系列
    'gemini-2.5-pro': { contextWindow: 1000000, maxOutput: 65536 },
    'gemini-2.5-flash': { contextWindow: 1000000, maxOutput: 32768 },
    // Gemini 2.0 系列
    'gemini-2.0-flash': { contextWindow: 1000000, maxOutput: 8192 },
    // 旧模型 (兼容)
    'gemini-1.5-pro': { contextWindow: 2097152, maxOutput: 8192 },
    'gemini-1.5-flash': { contextWindow: 1048576, maxOutput: 8192 },

    // ============ GLM (智谱) ============
    'glm-4.7': { contextWindow: 200000, maxOutput: 128000 },
    'glm-4.6': { contextWindow: 200000, maxOutput: 8192 },
    'glm-4-plus': { contextWindow: 128000, maxOutput: 4096 },
    'glm-4': { contextWindow: 128000, maxOutput: 4096 },
    'glm-4-air': { contextWindow: 128000, maxOutput: 4096 },
    'glm-4-flash': { contextWindow: 128000, maxOutput: 4096 },
    'glm-4-long': { contextWindow: 1000000, maxOutput: 4096 },

    // ============ MiniMax ============
    // MiniMax M2 系列 (2025年12月, 200K上下文可扩展1M)
    'MiniMax-M2.1': { contextWindow: 200000, maxOutput: 8192 },
    'MiniMax-M2.1-lightning': { contextWindow: 200000, maxOutput: 8192 },
    'MiniMax-M2': { contextWindow: 200000, maxOutput: 8192 },
};

/**
 * Get context window for a model
 * @param modelName - Full model name or partial match
 * @param provider - Provider type for fallback
 * @returns ModelInfo with context window and max output
 */
export function getModelContextWindow(modelName: string, provider?: AIProviderType): ModelInfo {
    // Exact match
    if (MODEL_CONTEXT_WINDOWS[modelName]) {
        return MODEL_CONTEXT_WINDOWS[modelName];
    }

    // Partial match (e.g., "gpt-4-0125-preview" matches "gpt-4")
    for (const [key, info] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
        if (modelName.startsWith(key)) {
            return info;
        }
    }

    // Fallback based on provider (使用各供应商最常用模型的默认值)
    if (provider) {
        switch (provider) {
            case 'openai':
                return { contextWindow: 400000, maxOutput: 128000 };  // gpt-5.2 默认值
            case 'claude':
                return { contextWindow: 200000, maxOutput: 8192 };   // claude-3-5-sonnet 默认值
            case 'deepseek':
                return { contextWindow: 65536, maxOutput: 8192 };    // deepseek-chat 默认值
            case 'gemini':
                return { contextWindow: 1000000, maxOutput: 65536 }; // gemini-3-pro 默认值
            case 'glm':
                return { contextWindow: 128000, maxOutput: 4096 };   // glm-4 默认值
            case 'minimax':
                return { contextWindow: 200000, maxOutput: 8192 };   // MiniMax-M2.1 默认值
            default:
                return { contextWindow: 128000, maxOutput: 8192 };
        }
    }

    // Ultimate fallback
    return { contextWindow: 128000, maxOutput: 4096 };
}

// 供应商默认端点
export const PROVIDER_ENDPOINTS: Record<AIProviderType, string | undefined> = {
    openai: 'https://api.openai.com/v1',
    claude: undefined,  // 使用 SDK 默认
    deepseek: 'https://api.deepseek.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    glm: 'https://open.bigmodel.cn/api/paas/v4',
    minimax: 'https://api.minimaxi.com/anthropic',
    custom: undefined
};

export interface AIMessageContentBlock {
    type: 'text' | 'image';
    text?: string;
    source?: {
        type: 'base64';
        media_type: string;
        data: string;
    };
    cache_control?: {
        type: 'ephemeral';
    };
}

export interface AIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | AIMessageContentBlock[] | null;
    reasoning_content?: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}
