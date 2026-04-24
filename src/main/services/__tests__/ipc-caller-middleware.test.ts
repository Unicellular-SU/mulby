import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  IpcPolicyError,
  resolveStorageNamespace
} from '../../ipc/_shared/caller-middleware'
import type { IpcCallerInfo } from '../ipc-caller-resolver'

// ============================================================
// 单元测试：IPC 调用方中间件 —— namespace 解析 + 策略错误类
// ============================================================
//
// 这里只覆盖「纯函数」行为；对 ipcMain 包装器的验证需要模拟 Electron
// 运行时（event.sender），放在 integration 层面，超出单元测试范畴。
// 但 `resolveStorageNamespace` 是整个 storage 越权修复的核心，单测必须覆盖。
// ============================================================

function makeCaller(partial: Partial<IpcCallerInfo> & { source: IpcCallerInfo['source'] }): IpcCallerInfo {
  return { ...partial }
}

describe('resolveStorageNamespace', () => {
  it('插件来源强制 plugin:<id>，忽略 renderer 传入的 namespace', () => {
    const caller = makeCaller({ source: 'plugin', pluginId: 'my-plugin', windowId: 10 })

    // renderer 试图访问 global / 其它插件 / 自定义 namespace，全部被覆写
    assert.equal(resolveStorageNamespace(caller, 'global'), 'plugin:my-plugin')
    assert.equal(resolveStorageNamespace(caller, 'rival-plugin'), 'plugin:my-plugin')
    assert.equal(resolveStorageNamespace(caller, 'custom'), 'plugin:my-plugin')
    assert.equal(resolveStorageNamespace(caller, undefined), 'plugin:my-plugin')
    assert.equal(resolveStorageNamespace(caller, ''), 'plugin:my-plugin')
  })

  it('主应用来源沿用 renderer 传入的 namespace', () => {
    const caller = makeCaller({ source: 'app', windowId: 1 })

    assert.equal(resolveStorageNamespace(caller, 'global'), 'global')
    assert.equal(resolveStorageNamespace(caller, 'settings-explorer'), 'settings-explorer')
    // 未提供 namespace 时兼容旧默认值 'global'
    assert.equal(resolveStorageNamespace(caller, undefined), 'global')
    assert.equal(resolveStorageNamespace(caller, ''), 'global')
  })

  it('插件来源但缺 pluginId（极端情况）退回 app 语义而非抛错', () => {
    // resolveIpcCallerSource 理论上不会给出 source='plugin' 且 pluginId=undefined 的组合，
    // 但这里做防御性校验：不要把 namespace 变成 'plugin:undefined' 导致越权
    const caller = makeCaller({ source: 'plugin', windowId: 99 })
    assert.equal(resolveStorageNamespace(caller, 'x'), 'x')
    assert.equal(resolveStorageNamespace(caller, undefined), 'global')
  })

  it('两个插件 pluginId 不同时，namespace 不冲突（核心隔离保证）', () => {
    const a = makeCaller({ source: 'plugin', pluginId: 'plugin-a' })
    const b = makeCaller({ source: 'plugin', pluginId: 'plugin-b' })

    assert.equal(resolveStorageNamespace(a, 'shared'), 'plugin:plugin-a')
    assert.equal(resolveStorageNamespace(b, 'shared'), 'plugin:plugin-b')
    assert.notEqual(
      resolveStorageNamespace(a, 'shared'),
      resolveStorageNamespace(b, 'shared')
    )
  })
})

describe('IpcPolicyError', () => {
  it('可以被 instanceof 识别并保留 message', () => {
    const err = new IpcPolicyError('自定义拒绝原因')
    assert.equal(err.name, 'IpcPolicyError')
    assert.equal(err.message, '自定义拒绝原因')
    assert.ok(err instanceof Error)
    assert.ok(err instanceof IpcPolicyError)
  })
})
