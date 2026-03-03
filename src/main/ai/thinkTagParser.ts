export interface ReasoningTagConfig {
  openingTag: string
  closingTag: string
  modelPattern?: RegExp
}

const DEFAULT_REASONING_TAGS: ReasoningTagConfig[] = [
  { openingTag: '<think>', closingTag: '</think>', modelPattern: /qwen3|deepseek|m2|minimax/i },
  { openingTag: '<thought>', closingTag: '</thought>', modelPattern: /gemini-2\.5/i },
  { openingTag: '<thinking>', closingTag: '</thinking>' },
  { openingTag: '###Thinking', closingTag: '###Response' },
  { openingTag: '◁think▷', closingTag: '◁/think▷', modelPattern: /kimi-vl-a3b-thinking/i },
  { openingTag: '<seed:think>', closingTag: '</seed:think>', modelPattern: /seed-oss-36b/i }
]

export interface ThinkTagStreamState {
  inThink: boolean
  carry: string
  activeTag: ReasoningTagConfig | null
  tags: ReasoningTagConfig[]
}

function longestSuffixPrefix(value: string, target: string): number {
  const max = Math.min(value.length, target.length - 1)
  for (let size = max; size > 0; size -= 1) {
    if (value.endsWith(target.slice(0, size))) return size
  }
  return 0
}

function selectReasoningTags(modelId?: string): ReasoningTagConfig[] {
  if (!modelId) return [...DEFAULT_REASONING_TAGS]
  const lowerModelId = modelId.toLowerCase()
  return [...DEFAULT_REASONING_TAGS].sort((a, b) => {
    const aMatched = a.modelPattern?.test(lowerModelId) ? 1 : 0
    const bMatched = b.modelPattern?.test(lowerModelId) ? 1 : 0
    return bMatched - aMatched
  })
}

function findNextOpeningTag(
  source: string,
  cursor: number,
  tags: ReasoningTagConfig[]
): { index: number; tag: ReasoningTagConfig } | null {
  let matched: { index: number; tag: ReasoningTagConfig } | null = null
  for (const tag of tags) {
    const index = source.indexOf(tag.openingTag, cursor)
    if (index === -1) continue
    if (!matched || index < matched.index) {
      matched = { index, tag }
    }
  }
  return matched
}

function findOpeningCarry(rest: string, tags: ReasoningTagConfig[]): string {
  let maxPartialSize = 0
  for (const tag of tags) {
    const partialSize = longestSuffixPrefix(rest, tag.openingTag)
    if (partialSize > maxPartialSize) {
      maxPartialSize = partialSize
    }
  }
  if (maxPartialSize === 0) return ''
  return rest.slice(-maxPartialSize)
}

export function createThinkTagStreamState(modelId?: string): ThinkTagStreamState {
  return {
    inThink: false,
    carry: '',
    activeTag: null,
    tags: selectReasoningTags(modelId)
  }
}

export function parseThinkTaggedChunk(
  chunk: string,
  state: ThinkTagStreamState
): { content: string; reasoning: string } {
  if (!chunk && !state.carry) {
    return { content: '', reasoning: '' }
  }

  const source = `${state.carry}${chunk}`
  state.carry = ''
  let cursor = 0
  let content = ''
  let reasoning = ''

  while (cursor < source.length) {
    if (state.inThink) {
      const activeTag = state.activeTag || state.tags[0]
      if (!activeTag) {
        reasoning += source.slice(cursor)
        break
      }
      const closingTag = activeTag.closingTag
      const targetIndex = source.indexOf(closingTag, cursor)
      if (targetIndex === -1) {
        const rest = source.slice(cursor)
        const partialSize = longestSuffixPrefix(rest, closingTag)
        const body = partialSize > 0 ? rest.slice(0, -partialSize) : rest
        reasoning += body
        state.carry = partialSize > 0 ? rest.slice(-partialSize) : ''
        break
      }

      reasoning += source.slice(cursor, targetIndex)
      cursor = targetIndex + closingTag.length
      state.inThink = false
      state.activeTag = null
      continue
    }

    const openingTagMatch = findNextOpeningTag(source, cursor, state.tags)
    if (!openingTagMatch) {
      const rest = source.slice(cursor)
      const carry = findOpeningCarry(rest, state.tags)
      const body = carry ? rest.slice(0, -carry.length) : rest
      content += body
      state.carry = carry
      break
    }

    if (openingTagMatch.index > cursor) {
      content += source.slice(cursor, openingTagMatch.index)
    }

    cursor = openingTagMatch.index + openingTagMatch.tag.openingTag.length
    state.inThink = true
    state.activeTag = openingTagMatch.tag
  }

  return { content, reasoning }
}

export function finalizeThinkTagStream(state: ThinkTagStreamState): { content: string; reasoning: string } {
  if (!state.carry) {
    return { content: '', reasoning: '' }
  }
  const value = state.carry
  state.carry = ''
  if (state.inThink) {
    return { content: '', reasoning: value }
  }
  return { content: value, reasoning: '' }
}

export function splitThinkTaggedText(text: string, modelId?: string): { content: string; reasoning: string } {
  const state = createThinkTagStreamState(modelId)
  const parsed = parseThinkTaggedChunk(text, state)
  const tail = finalizeThinkTagStream(state)
  return {
    content: parsed.content + tail.content,
    reasoning: parsed.reasoning + tail.reasoning
  }
}
