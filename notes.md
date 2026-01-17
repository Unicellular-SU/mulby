# Notes: UtilityProcess Search

## Sources

### Source 1: Plugin search flow
- URL: local repo
- Key points:
  - Search IPC is `plugin:search` → `PluginManager.search`.
  - Search logic in `src/main/plugin/manager.ts`.

## Synthesized Findings

### Worker Design
- Create UtilityProcess to perform search matching with plugin/feature data snapshot.
- IPC returns results to main, then to renderer unchanged.
