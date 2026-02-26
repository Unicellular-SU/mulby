import { TaskAnalysis, TaskComplexity } from '../types/plan';
import { AIServiceFactory } from './ai';

/**
 * Task Analyzer - uses AI to determine task complexity
 * and whether planning mode should be triggered
 */
export class TaskAnalyzer {
    private static _aiService: ReturnType<typeof AIServiceFactory.create> | null = null;

    /** 延迟初始化 AI 服务，只在真正需要时创建 */
    private static get aiService() {
        if (!this._aiService) {
            this._aiService = AIServiceFactory.create();
        }
        return this._aiService;
    }

    /**
     * Use AI to analyze task complexity
     */
    static async analyze(userInput: string): Promise<TaskAnalysis> {
        const prompt = `分析以下用户任务，判断其复杂度。只返回 JSON，不要其他内容。

用户任务：
${userInput}

返回格式：
{
  "complexity": "simple" | "medium" | "complex",
  "shouldPlan": true | false,
  "estimatedSteps": number,
  "reason": "简短说明原因"
}

判断标准：
- simple: 单一明确的小任务，如修复一个 bug、改个文案、加个注释
- medium: 需要 2-4 个步骤的任务，如实现一个小功能、重构一个模块
- complex: 需要 5+ 个步骤或涉及多个模块/领域的任务，如设计系统架构、实现完整功能模块

注意：如果用户只是粘贴了错误信息让你修复，这通常是 simple 任务。`;

        try {
            const response = await this.aiService.chat([
                { role: 'user', content: prompt }
            ], {
                maxTokens: 200,
                temperature: 0
            });

            const content = response.content?.trim() || '';
            // Extract JSON from response (handle potential markdown code blocks)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return {
                    complexity: result.complexity || 'simple',
                    estimatedSteps: result.estimatedSteps || 1,
                    shouldPlan: result.shouldPlan ?? (result.complexity !== 'simple'),
                    requiredFiles: [],
                    dependencies: [],
                    risks: [],
                    reason: result.reason
                };
            }
        } catch (error) {
            // Fallback to simple if AI analysis fails
            console.error('AI analysis failed:', error);
        }

        // Default fallback
        return {
            complexity: 'simple',
            estimatedSteps: 1,
            shouldPlan: false,
            requiredFiles: [],
            dependencies: [],
            risks: []
        };
    }

    /**
     * Quick check - skip analysis only for obvious non-task inputs
     * We want AI to decide for most cases, so keep this minimal
     */
    static shouldSkipAnalysis(input: string): boolean {
        const trimmed = input.trim();

        // Skip for very short inputs (likely just a word or two)
        if (trimmed.length < 10) return true;

        // Skip for greetings and simple commands
        if (this.isSimpleCommand(trimmed)) return true;

        // Skip for pure informational questions (not task requests)
        // Only skip "what is X" type questions, not "how to implement X"
        if (/^(什么是|是什么|.{1,5}是啥)/.test(trimmed)) return true;
        if (/^what\s+(is|are)\s+/i.test(trimmed)) return true;

        return false;
    }

    /**
     * Get a human-readable description of the analysis
     */
    static getAnalysisDescription(analysis: TaskAnalysis): string {
        const complexityMap = {
            simple: '简单任务',
            medium: '中等复杂度任务',
            complex: '复杂任务'
        };

        let desc = `${complexityMap[analysis.complexity]}`;
        if (analysis.estimatedSteps > 1) {
            desc += `（预估 ${analysis.estimatedSteps} 个步骤）`;
        }
        if (analysis.reason) {
            desc += `\n   原因：${analysis.reason}`;
        }

        return desc;
    }

    /**
     * Check if the input looks like it's asking a question
     */
    static isQuestion(input: string): boolean {
        const questionPatterns = [
            /^(什么|怎么|如何|为什么|哪个|哪些|是否|能否|可以吗)/,
            /\?$/,
            /^(what|how|why|which|where|when|is|are|can|could|would|should)/i,
            /吗[？?]?$/,
            /呢[？?]?$/
        ];

        return questionPatterns.some(p => p.test(input.trim()));
    }

    /**
     * Check if the input is a simple command or greeting
     */
    static isSimpleCommand(input: string): boolean {
        const simplePatterns = [
            /^(你好|hi|hello|hey)/i,
            /^(谢谢|thanks|thank you)/i,
            /^(好的|ok|okay|sure)/i,
            /^(继续|continue|go on)/i,
            /^(是|否|yes|no)$/i
        ];

        return simplePatterns.some(p => p.test(input.trim()));
    }
}
