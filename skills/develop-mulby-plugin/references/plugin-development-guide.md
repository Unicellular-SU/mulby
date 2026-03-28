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
|- icon.png               # packaged plugin icon
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
|  `- icon.svg            # editable icon source (recommended)
```

For basic plugins without UI, the minimum structure is usually:

```text
my-plugin/
|- manifest.json
|- icon.png
|- package.json
|- src/
|  |- main.ts
|- assets/
|  `- icon.svg
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
- whether the plugin should expose tools for AI Agent (`manifest.tools`)
- whether any feature should match by foreground app (`cmds` with `type: 'window'`)

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

### Phase 4: Finalize Icon Assets

Once the plugin behavior and theme are stable:

- keep an editable source icon such as `assets/icon.svg`
- generate a plugin-specific SVG that matches the plugin purpose and color palette
- prefer the `generate-electron-icons` skill when it is available, or use an equivalent deterministic SVG-to-PNG workflow
- replace the scaffolded root `icon.png` with the final 512x512 export
- keep `manifest.icon` aligned, usually as `icon.png`

### Phase 5: Validate Before Handoff

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
- `icon`: packaged plugin icon, typically `icon.png`
- `pluginSetting`
- `window`
  - `type`: window type (`default` with titlebar, `borderless` without frame, `fullscreen` fills screen)
  - `titleBar`: explicitly control whether Mulby injects a titlebar (`default` type defaults to `true`, others to `false`)
  - `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`: size constraints
  - `opacity`: initial window opacity (0.0 ~ 1.0, adjustable at runtime via `window.mulby.window.setOpacity()`)
  - `transparent`: enable window background transparency (combine with CSS `background: transparent` for see-through areas, only effective at creation time)
- `tools`: optional AI tool declarations (see Plugin Tools section below)
- `features`

### Window Types

- **`default`** (default): Standard detached window with Mulby-injected titlebar (pin, minimize, maximize, close buttons).
- **`borderless`**: No frame or titlebar. Plugin UI must handle dragging with CSS `-webkit-app-region: drag` and closing via `window.mulby.window.close()`.
- **`fullscreen`**: Window fills the primary screen work area. No titlebar injected. Suitable for immersive tools like screenshot editors or canvas apps.

## Icon Workflow

Use this when the plugin code is done or the UI theme has clearly settled:

1. Keep the editable icon source as SVG, for example `assets/icon.svg`.
2. Ask the image model or design workflow to produce an SVG that matches the plugin function, tone, and color palette.
3. Convert that SVG into the final 512x512 `icon.png`.
4. Prefer the `generate-electron-icons` skill when it is available. If it is not, use an equivalent deterministic SVG-to-PNG workflow.
5. Copy the final PNG to the plugin root as `icon.png`, replacing the scaffold default.
6. Leave `manifest.icon` pointed at `icon.png` unless the project intentionally uses another supported format.
7. Before packaging, visually review the final icon against the plugin UI and confirm it is the file that will be bundled.

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

## Plugin Tools (AI Agent Integration)

Plugins can declare tools that AI Agents can discover and call. This turns a plugin into an AI tool provider, similar to an MCP Server but managed through the Mulby plugin system.

### Manifest Declaration

Add a top-level `tools` array to `manifest.json`:

```json
{
  "tools": [
    {
      "name": "search_docs",
      "description": "Search documentation by keyword",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search keyword" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

### Handler Registration

Register handlers in `main.ts` using `context.api.tools`:

```typescript
export function onLoad() {
  const { tools } = context.api
  tools.register('search_docs', async (args) => {
    const { query } = args
    return await performSearch(query)
  })
}
```

### Key Rules

- Tool names must match `[a-zA-Z0-9_-]` and be unique per plugin.
- Every tool declared in manifest must have a corresponding handler registered in `onLoad`.
- A plugin can have `tools` without `features` (pure AI tool provider).
- Priority order: Built-in tools > MCP tools > Plugin tools.
- See `references/apis/tools.md` for the full API reference.

## Backend Build Rules

When a plugin has backend code that needs bundling (e.g. TypeScript → JavaScript):

- Use `--packages=external` with esbuild to **externalize all npm dependencies**.
- The build command should be: `esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js --packages=external`
- This produces a small bundle containing only the plugin's own source code.
- All npm packages (`sharp`, `svgo`, `image-size`, etc.) are loaded from `node_modules` at runtime.

**Why this matters**: esbuild cannot correctly bundle certain npm packages that use:

- `createRequire(import.meta.url)` — produces `createRequire(undefined)` when transpiled to CJS
- Glob require patterns (`require('./types/**/*')`) — generates mismatched extension keys
- Relative JSON file loading via `createRequire` — paths break when flattened into a single file
- Top-level scope variables that depend on proper module context

Without `--packages=external`, any plugin with complex Node.js dependencies (image processing, SVG optimization, PDF generation, etc.) will fail at runtime with cryptic errors.

**The `.gitignore` should NOT exclude `node_modules`** when using `--packages=external`, because the plugin needs `node_modules` at runtime. However, if packing the plugin as `.inplugin`, the pack process should handle dependency inclusion.

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
5. The final `icon.png` is the intended branded icon, not the scaffold default, when icon work is part of the task.
6. The core user task succeeds on realistic sample input.
