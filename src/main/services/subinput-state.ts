// SubInput 状态管理
// 独立模块，避免循环依赖

const DEFAULT_FORWARD_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape', 'PageDown', 'PageUp']

interface SubInputState {
    enabled: boolean
    placeholder: string
    ownerId: number  // 调用者 webContents id，用于标识哪个插件拥有 SubInput
    forwardKeys: string[]
}

let subInputState: SubInputState = {
    enabled: false,
    placeholder: '',
    ownerId: 0,
    forwardKeys: []
}

export function getSubInputState(): SubInputState {
    return subInputState
}

export function setSubInputState(state: Partial<SubInputState>): void {
    subInputState = { ...subInputState, ...state }
}

export function clearSubInputState(): void {
    subInputState = { enabled: false, placeholder: '', ownerId: 0, forwardKeys: [] }
}

export function isSubInputEnabled(): boolean {
    return subInputState.enabled
}

export function getSubInputOwnerId(): number {
    return subInputState.ownerId
}

export function getSubInputForwardKeys(): string[] {
    return subInputState.forwardKeys
}

export function buildForwardKeys(extraKeys?: string[]): string[] {
    if (!extraKeys || extraKeys.length === 0) return DEFAULT_FORWARD_KEYS
    const set = new Set([...DEFAULT_FORWARD_KEYS, ...extraKeys])
    return [...set]
}
