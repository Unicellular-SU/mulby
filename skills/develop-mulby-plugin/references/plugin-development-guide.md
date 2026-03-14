# Plugin Development Guide

This reference is a bundled, portable summary of the Mulby plugin development rules that matter most when building or fixing a plugin.

For full Mulby-specific details, also read:

- `references/PLUGIN_DEVELOP_PROMPT.md`
- `references/apis/README.md`
- the specific files under `references/apis/*.md` that match the capability you need

## Architecture

Mulby plugins run in an Electron multi-process environment.

- `UI` means the renderer process and usually accesses APIs through `window.mulby.{module}`.
- `Main` means the backend plugin process and usually accesses APIs through `context.api.{module}`.
- `preload.cjs` is only for bridging Node.js or Electron capabilities into UI code when direct access is not available.

Keep responsibilities clear:

- UI handles rendering, interaction, and presentation state.
- Main handles feature entry logic, background work, I/O, and privileged operations.
- Preload exposes only the narrow bridge the UI truly needs.

## Typical Project Structure

```text
my-plugin/
|- manifest.json
|- package.json
|- tsconfig.json
|- vite.config.ts
|- preload.cjs            # optional, CommonJS only
|- src/
|  |- main.ts
|  |- ui/
|     |- main.tsx
|     |- App.tsx
|     |- styles.css
|     |- hooks/
|        |- useMulby.ts
|- assets/
```

For basic plugins without UI, the minimum structure is usually:

```text
my-plugin/
|- manifest.json
|- package.json
|- src/
|  |- main.ts
```

## Fixed Workflow

### Phase 0: Integration Recon

Before changing implementation details:

- inspect `manifest.json`
- inspect `src/main.ts`
- inspect `src/ui/App.tsx` when the plugin has UI
- inspect `preload.cjs` when present

For a new plugin, decide the template first, then inspect the scaffold before adding complexity.

### Phase 1: Define the Plugin Contract

Lock down the contract before major coding:

- which `features[].code` values exist
- which `cmds` trigger each feature
- whether each feature is `ui`, `silent`, or `detached`
- what belongs in UI, Main, and preload
- whether background mode, scheduler work, or host APIs are needed

### Phase 2: Minimum Runnable Path

Implement one end-to-end path first:

- `manifest.json` points to real entry files
- `src/main.ts` handles the real feature entry
- UI plugins have a usable `src/ui/App.tsx`
- `preload.cjs` is only added when bridging is required

### Phase 3: Expand Features

Only after the minimum path works:

- add more triggers
- refine UX
- add background or host integrations
- add preload bridges if truly needed

### Phase 4: Validate Before Handoff

Verify all applicable items:

- required manifest fields are complete
- each `feature.code` maps to real handling logic
- `main`, `ui`, and `preload` paths exist
- `preload.cjs` stays CommonJS
- the plugin builds successfully
- packaging succeeds when requested

## Manifest Essentials

Typical top-level fields:

- `name`: plugin id
- `displayName`: human-readable name
- `version`
- `description`
- `main`: backend entry, typically `dist/main.js`
- `ui`: frontend entry when the plugin has UI, typically `ui/index.html`
- `preload`: optional preload path, typically `preload.cjs`
- `icon`
- `pluginSetting`
- `window`
- `features`

## Feature Essentials

Each feature should define:

- `code`: unique feature id
- `explain`: human-readable description
- `cmds`: one or more trigger definitions
- optional `mode`: `ui`, `silent`, or `detached`
- optional `route`
- optional `mainPush`
- optional `mainHide`

Common trigger types:

- `keyword`
- `regex`
- `files`
- `img`
- `over`

Design the feature list intentionally. Do not ship leftover template features that do not map to actual behavior.

## Preload Rules

Use `preload.cjs` only when the UI needs a bridge to Node.js or Electron capabilities such as:

- `fs`
- `crypto`
- `child_process`
- selected Electron modules

Rules:

- the file must end with `.cjs`
- the module format must be CommonJS
- keep business logic out of preload
- expose the smallest safe surface area needed by the UI

## Manual Acceptance Checklist

The final handoff should tell the user to verify these points inside Mulby:

1. The plugin installs or loads without manifest errors.
2. At least one trigger path actually enters the plugin.
3. The expected UI opens, or the silent feature completes without UI.
4. Detached, background, or preload behavior works if configured.
5. The core user task succeeds on realistic sample input.
