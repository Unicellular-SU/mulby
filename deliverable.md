# Img Cmd Extension Filter Deliverable

## Design Summary
- Added optional `exts` filtering for `img` commands to allow extension-specific image matching.
- Kept existing `img` behavior when `exts` is omitted.

## Key Code Paths
- Matching logic: `src/main/plugin/manager.ts`
- Types: `src/shared/types/plugin.ts`
- Dynamic features: `src/main/plugin/dynamic-features.ts`
- Docs: `docs/manifest-v2.md`, `docs/apis/features.md`
