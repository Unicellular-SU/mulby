/**
 * 工具循环上下文压缩（P0：单轮内防溢出）。
 *
 * 背景：agentic 工具循环里，每一步都会把「之前所有工具结果」原样重发给模型；
 * read_file / grep 这类大结果累积起来会迅速逼近甚至超出模型上下文窗口（尤其在
 * maxToolSteps 调大到 200 之后）。这里在**不破坏 tool_call ↔ tool_result 配对**的
 * 前提下，把「较早的工具结果」替换成占位文本，始终保留最近若干条工具结果（热尾）
 * 与全部消息的结构与顺序。等价于 opencode 的 prune（廉价、不调 LLM）。
 *
 * 安全约束（此路径服务所有插件，零容忍回归）：
 * - 纯函数、可单测；预算未超时**返回原数组引用**（调用方据此判断 no-op）。
 * - 只缩小「工具结果」内容，绝不删除消息、绝不改 toolCallId / 顺序。
 * - 同时兼容两种消息形态：
 *     1) OpenAI 兼容手动循环：{ role:'tool', tool_call_id, content: string }
 *     2) AI SDK ModelMessage：{ role:'tool', content: [{ type:'tool-result', toolCallId, toolName, output }] }
 * - 任何异常都退回原数组：宁可不压缩，也不破坏消息结构。
 */

export interface ToolContextCompactionOptions {
  /** 触发压缩的总字符预算（约 4 字符 ≈ 1 token）。总量低于此值直接 no-op。 */
  maxChars?: number
  /** 热尾：始终完整保留最近这么多条工具结果。 */
  keepRecentToolResults?: number
  /** 占位文本（替换被裁剪的旧工具结果）。 */
  placeholder?: string
}

/** ~120k tokens。仅当拿不到模型真实窗口时用作安全粗下限，正常对话为 no-op。 */
export const DEFAULT_COMPACTION_MAX_CHARS = 480_000
export const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 8
/** 字符↔token 粗估比（与宿主 tokenizer 的 fallback 一致）。 */
export const CHARS_PER_TOKEN = 4
const DEFAULT_PLACEHOLDER =
  '[较早的工具结果已省略以节省上下文；如仍需要请重新读取对应文件或重跑该工具]'

/**
 * 由模型真实上下文窗口（token）算出压缩触发的字符预算：
 * 预留输出 token，再留 ~10% buffer，最后按 ~4 字符/token 折算成字符。
 * `contextTokens` 未知（≤0）时返回 undefined —— 调用方应退回安全粗下限，
 * 切勿用错误的固定值激进压缩，以免误伤百万级上下文模型。
 */
export function computeCompactionMaxChars(contextTokens?: number, maxOutputTokens?: number): number | undefined {
  if (!contextTokens || contextTokens <= 0) return undefined
  const reserveOutput = Math.min(
    maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : Math.floor(contextTokens * 0.15),
    32_000
  )
  const usableTokens = Math.max(4_000, contextTokens - reserveOutput)
  return Math.floor(usableTokens * 0.9 * CHARS_PER_TOKEN)
}

function estimateContentChars(content: unknown): number {
  if (content == null) return 0
  if (typeof content === 'string') return content.length
  try {
    return JSON.stringify(content).length
  } catch {
    return 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

/** 是否为「工具结果」消息。两种形态都通过 role:'tool' 判定，最稳。 */
function isToolResultMessage(msg: unknown): boolean {
  return isRecord(msg) && msg.role === 'tool'
}

/** 把一条工具结果消息的内容替换为占位（保留 role / tool_call_id / toolName / type 等结构）。 */
function shrinkToolMessage(
  msg: Record<string, unknown>,
  placeholder: string
): Record<string, unknown> {
  const content = msg.content
  // 形态 1：字符串内容（OpenAI 兼容手动循环）
  if (typeof content === 'string') {
    return { ...msg, content: placeholder }
  }
  // 形态 2：parts 数组（AI SDK ModelMessage）
  if (Array.isArray(content)) {
    const nextParts = content.map((part) => {
      if (!isRecord(part)) return part
      if (part.type === 'tool-result' || 'output' in part) {
        return { ...part, output: { type: 'text', value: placeholder } }
      }
      return part
    })
    return { ...msg, content: nextParts }
  }
  return msg
}

/**
 * 在超出字符预算时，从最早的工具结果开始替换为占位，直到回到预算内或只剩热尾。
 * 未超预算或无可裁剪项时返回原数组引用（no-op）。
 */
export function compactToolResultMessages<T = unknown>(
  messages: T[],
  options?: ToolContextCompactionOptions
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages
  const maxChars = options?.maxChars ?? DEFAULT_COMPACTION_MAX_CHARS
  const keepRecent = Math.max(0, options?.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS)
  const placeholder = options?.placeholder ?? DEFAULT_PLACEHOLDER

  try {
    let total = 0
    for (const msg of messages) total += estimateContentChars((msg as Record<string, unknown>)?.content)
    if (total <= maxChars) return messages // no-op：返回原引用

    const toolIdxs: number[] = []
    for (let i = 0; i < messages.length; i += 1) {
      if (isToolResultMessage(messages[i])) toolIdxs.push(i)
    }
    if (toolIdxs.length <= keepRecent) return messages // 没有可裁剪的旧工具结果

    // 受保护的热尾（最近 keepRecent 条工具结果不动）
    const protectedSet = new Set(toolIdxs.slice(toolIdxs.length - keepRecent))

    const next = messages.slice()
    let changed = false
    for (const idx of toolIdxs) {
      if (total <= maxChars) break
      if (protectedSet.has(idx)) continue
      const before = estimateContentChars((next[idx] as Record<string, unknown>)?.content)
      const shrunk = shrinkToolMessage(next[idx] as Record<string, unknown>, placeholder)
      const after = estimateContentChars(shrunk.content)
      if (after < before) {
        next[idx] = shrunk as unknown as T
        total -= before - after
        changed = true
      }
    }
    return changed ? next : messages
  } catch {
    // 任何异常退回原数组：不压缩好过破坏消息结构
    return messages
  }
}
