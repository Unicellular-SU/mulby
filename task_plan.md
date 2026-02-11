# Task Plan: Mulby 全量改名为 Mulby

## Goal
将仓库内所有 Mulby/mulby/mulby 相关命名统一迁移为 Mulby/mulby（一次性切断，不保留兼容层），并完成构建与检索验收。

## Phases
- [x] Phase 1: 方案确认（兼容策略、标识范围、仓库目录策略）
- [x] Phase 2: 批量内容替换（代码/文档/配置）
- [x] Phase 3: 目录与文件重命名（packages/docs/plugins/types）
- [x] Phase 4: 依赖与构建产物一致性修复（lock/bin/import/path）
- [x] Phase 5: 构建与验收（typecheck/build/关键词清零）

## Key Questions
1. 兼容策略：是否保留 `window.mulby` / `mulby` 命令别名？（否，一次性切断）
2. 标识范围：是否只改展示名还是全量技术标识？（全量替换）
3. 仓库目录 `/Users/su/workspace/mulby` 是否改名？（否，本次不改）

## Decisions Made
- 全量替换：品牌、CLI、API、配置目录、appId、scope、插件示例名。
- 不保留兼容层：`window.mulby` 和 `mulby` 命令直接迁移到 `window.mulby` 与 `mulby`。
- 不直接改二进制或第三方目录：通过源码替换与重建保证一致性。

## Errors Encountered
- `git mv` 在沙箱内无法创建 `.git/index.lock`。
  - 处理：使用提权命令完成批量路径重命名。

## Status
**Completed** - 全量改名完成，构建通过，旧关键词在仓库（排除 `node_modules/.git`）中检索为 0。
