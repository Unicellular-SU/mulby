# Storage V2 Code Review 修复总结

## 修复概览

修复了 codex review 发现的全部 7 个问题（3 P1 + 4 P2）。

## P1 修复（正确性问题）

### 1. CAS 写入不再重建已删除的 key
- **文件**: `src/main/plugin/storage.ts` · `_setOneWithVersion()`
- **问题**: 数字 `expectedVersion` 在 key 不存在时会 fallthrough 到 `casInsertOnlyStmt`，导致可以重建被其他 writer 删除的 key
- **修复**: 数字 `expectedVersion` + key 不存在 → 直接返回 `{ ok: false, conflict: { currentVersion: 0 } }`，仅 `expectedVersion === null` 才允许 create-if-absent

### 2. 插件端 setMany 正确处理原子冲突
- **文件**: `src/main/plugin/storage.ts` · `setMany()`
- **问题**: `setManyAtomicTransaction()` 抛出异常回滚，但插件端没有 catch，导致插件收到未处理异常
- **修复**: 添加 try/catch，将异常中的 `results` 翻译为 `{ success: false, results }` 返回

### 3. 插件端 transaction 正确处理冲突
- **文件**: `src/main/plugin/storage.ts` · `transaction()`
- **问题**: 同上，`transactionExec()` 抛异常但插件端没有 catch
- **修复**: 添加 try/catch，将异常中的 `result` 翻译为标准 `StorageTransactionResult` 返回

## P2 修复

### 4. Legacy storage:set 保留 version 计数器
- **文件**: `src/main/ipc/storage.ts` · `stmtSet`
- **问题**: `INSERT OR REPLACE` 删除旧行再插入，将 version 重置为默认值 0
- **修复**: 使用 `INSERT ... ON CONFLICT DO UPDATE SET version = version + 1`

### 5. watch 订阅按调用跟踪（非按 webContents）
- **文件**: `src/main/ipc/storage.ts` · watch/unwatch + `src/preload/apis/platform-api.ts`
- **问题**: 同一窗口多次 `watch()` 会覆盖前一个过滤条件
- **修复**: 引入自增 `watchIdCounter`，每次调用产生独立 ID；`unwatch` 按 ID 移除；webContents 销毁时批量清理该 wcId 下所有 watcher

### 6. CLI 模板类型同步
- **文件**: `packages/mulby-cli/src/commands/create/templates/react/types.ts`
- **问题**: `BackendPluginAPIDirect.storage` 和 `MulbyStorage` 仍为 V1 类型
- **修复**: 两个接口均添加了全部 V2 方法声明

### 7. 非原子 setMany 也触发 watch 广播
- **文件**: `src/main/ipc/storage.ts` · `storage:setMany` handler
- **问题**: 广播逻辑被 `result.success` 门控，非原子模式下部分成功的项不会触发事件
- **修复**: 遍历 `result.results`，每个 `ok: true` 的项独立广播

## 验证结果

- ✅ `npx tsc --noEmit` 零错误通过
