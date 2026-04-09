# Notes: Review current code changes

## Changed files
- `src/main/ai/tools/internal-tool-runtime.ts`
- `src/main/ai/tools/web-search-service.ts`
- `src/main/services/app-settings.ts`
- `src/main/services/search-window-service.ts`
- `src/shared/types/settings.ts`
- `docs/local-search-improvements.md` (design/progress note)

## Candidate findings

### 1. Auto-fetch of search result pages bypasses HTTP deny policy
- New local search enrichment path calls `executor.fetchContent()` for every result URL.
- Unlike `webFetchTool`, this path never runs `assertHttpUrlAllowed()` or equivalent host/CIDR checks.
- If a local engine or provider returns `http://127.0.0.1`, `http://192.168.x.x`, etc., the app will probe internal services as a side effect of `web_search`.
- Strong finding; security-sensitive.

### 2. `web_fetch` fallback converts real fetch failures into fake success
- `SearchWindowService.fetchContent()` returns `{ content: '' }` on timeout/network/non-200.
- `WebSearchService.fetch()` then returns `success: true` with `No content found` whenever Jina fails and local fallback also fails.
- This hides outages/errors from callers and changes a hard failure into an apparently successful empty page.
- Strong finding; user-visible regression.

## Ruled out / weaker observations
- `language` is plumbed through local search but not actually used; likely incomplete, but behavior was already effectively ignored before this patch.
- Local fallback downloads full bodies before truncating extracted text; performance concern, but less certain as a must-fix review finding.
