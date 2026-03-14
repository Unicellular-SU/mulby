## CLI AI Appendix

This appendix is injected only into Mulby CLI AI generation sessions. It adds agent-specific working rules on top of the shared plugin development guide.

### Working Mode

- Treat the shared `PLUGIN_DEVELOP_PROMPT.md` as the architectural base.
- When repository docs are available, prefer `docs/apis/README.md`, the relevant `docs/apis/*.md` files, and `src/shared/types/electron.d.ts` over memory or stale examples.
- If the shared guide and the actual scaffold or runtime types differ, follow the scaffold and runtime types.

### Required Execution Order

When modifying an existing plugin or a freshly scaffolded plugin, do this in order:

1. Read `manifest.json`.
2. Read `src/main.ts`.
3. Read `src/ui/App.tsx` if the plugin has UI.
4. Read `preload.cjs` if it exists.
5. Lock the feature contract before major implementation.
6. Build one runnable path before polishing or expanding scope.

### Contract Rules

- Every `features[].code` must map to real logic.
- Every trigger in `cmds` must be intentional and testable.
- Keep UI, backend, and preload responsibilities explicit.
- Add `preload.cjs` only when Node.js or Electron bridging is required.

### Validation Rules

- Do not consider the task complete just because the code looks finished.
- Run the available validation path before finish.
- Prefer build validation before handoff.
- In the final response, include concrete Mulby-side manual checks.

### Forbidden Shortcuts

- Do not create `preview.html`, `demo.html`, or other browser-only preview files.
- Do not create junk docs such as temp instructions or icon guide placeholders.
- Do not run watch-mode commands unless the user explicitly asks for them.
- Do not leave template placeholders in `manifest.json`, `src/main.ts`, or UI code.
