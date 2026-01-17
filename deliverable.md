# UtilityProcess Search Deliverable

## Implemented
- Moved plugin matching into a UtilityProcess worker to keep main process responsive.
- Shared matching logic via `src/shared/search-matcher.ts` to keep behavior consistent between worker and fallback path.
- Added main-process fallback when the worker fails or times out.

## Key Paths
- Worker protocol: `src/main/plugin/search-protocol.ts`
- Worker process: `src/main/plugin/search-worker.ts`
- Worker manager: `src/main/plugin/search-worker-manager.ts`
- Shared matcher: `src/shared/search-matcher.ts`
- Integration: `src/main/plugin/manager.ts`, `src/main/ipc/plugin.ts`
