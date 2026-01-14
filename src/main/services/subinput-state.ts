// SubInput 状态管理
// 独立模块，避免循环依赖

interface SubInputState {
    enabled: boolean
    placeholder: string
    ownerId: number  // 调用者 webContents id，用于标识哪个插件拥有 SubInput
}

let subInputState: SubInputState = {
    enabled: false,
    placeholder: '',
    ownerId: 0
}

export function getSubInputState(): SubInputState {
    return subInputState
}

export function setSubInputState(state: Partial<SubInputState>): void {
    subInputState = { ...subInputState, ...state }
}

export function clearSubInputState(): void {
    subInputState = { enabled: false, placeholder: '', ownerId: 0 }
}

export function isSubInputEnabled(): boolean {
    return subInputState.enabled
}

export function getSubInputOwnerId(): number {
    return subInputState.ownerId
}
