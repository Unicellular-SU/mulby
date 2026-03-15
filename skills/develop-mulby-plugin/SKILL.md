---
name: develop-mulby-plugin
description: Create, modify, validate, and package Mulby plugins with the Mulby CLI and bundled Mulby plugin references. Use when a task involves scaffolding a Mulby plugin, choosing a React vs basic template, wiring `manifest.json` features to `src/main.ts` and UI or preload files, selecting Mulby host APIs, finalizing a themed plugin icon, or producing a `.inplugin` package.
---

# Develop Mulby Plugin

Use this skill for both new Mulby plugins and existing plugin fixes. The goal is to ship an attachable plugin, not just generate code fragments.

## Workflow

1. Start with recon.
   - Existing plugin: inspect `manifest.json`, `src/main.ts`, `src/ui/App.tsx` when UI exists, and `preload.cjs` when present.
   - New plugin: choose the correct template before creating files.
2. Pick the template deliberately.
   - Use `react` for any visible UI, detached window, routed interface, or richer interactive flow.
   - Use `basic` for command-only, silent, or background-first plugins with no frontend.
3. Scaffold with the local CLI.
   - Read [references/cli-workflow.md](references/cli-workflow.md) for exact commands.
   - Prefer the bundled wrapper `scripts/invoke_mulby_cli.mjs`. It is cross-platform and can use a local install, a global `mulby`, or `npx mulby-cli`.
   - Do not use `mulby create --ai` when you are already the AI agent doing the work.
4. Lock the plugin contract before major edits.
   - Define every `features[].code`.
   - Define each trigger in `cmds`.
   - Decide the mode for each feature: `ui`, `silent`, or `detached`.
   - Decide whether logic belongs in backend, UI, or `preload.cjs`.
   - Decide which Mulby APIs are needed.
5. Build one minimum runnable path first.
   - Make `manifest.json` match real files.
   - Implement one happy path that can actually be triggered inside Mulby.
   - Add extra features only after the minimum path is attachable.
6. Finalize icon assets after the plugin direction is stable.
   - Keep an editable SVG source such as `assets/icon.svg` while the plugin feature set or UI theme is still evolving.
   - After the plugin function and visual theme are settled, generate a plugin-specific SVG icon that matches the feature purpose and color palette.
   - Prefer the `generate-electron-icons` skill when it is available. Otherwise use an equivalent deterministic SVG-to-PNG workflow.
   - Replace the scaffolded root `icon.png` with the final 512x512 export before packaging.
7. Validate before handoff.
   - Run `npm install` in the plugin directory when dependencies are missing.
   - Run build and pack commands when the task calls for a deliverable package.
   - Report exact Mulby-side checks the user should run manually.

## Mulby Rules

- Treat `manifest.json` as the plugin contract and source of truth.
- Keep `features` intentional. Do not leave template placeholders behind.
- Add `preload.cjs` only when Node.js or Electron bridging is required.
- When `preload.cjs` exists, keep it in CommonJS and wire `manifest.preload` to the real file.
- Keep editable icon source files as SVG during development; packaged plugins should normally end with a final root `icon.png`.
- Do not create preview-only HTML files such as `preview.html` or `demo.html`.
- Avoid watch mode or long-running dev commands unless the user explicitly asks for them.
- If bundled references and the target environment diverge, trust the target environment's implementation and current type definitions.

## What To Read

- Read [references/cli-workflow.md](references/cli-workflow.md) when you need exact `create`, `build`, or `pack` behavior, or when you need to know what each template generates.
- Read [references/plugin-development-guide.md](references/plugin-development-guide.md) when you need the full integration checklist, manifest rules, and preload constraints.
- Read [references/api-map.md](references/api-map.md) when you need a bundled Mulby API navigator and module selection guide.
- Read [references/PLUGIN_DEVELOP_PROMPT.md](references/PLUGIN_DEVELOP_PROMPT.md) when you need the fuller Mulby plugin development prompt and examples.
- Read [references/apis/README.md](references/apis/README.md) first when a task depends on specific Mulby APIs, then open the relevant `references/apis/*.md` files for exact module details.

## Handoff Checklist

Before claiming completion, verify all of the following when applicable:

- `manifest.json` required fields are complete.
- Every `feature.code` maps to real handling logic.
- `main`, `ui`, and `preload` paths point to files that exist.
- `preload.cjs` is only present when needed and stays CommonJS.
- If icon work is in scope, an editable SVG source is kept and the scaffold default `icon.png` has been replaced with the final 512x512 export.
- `npm run build` succeeds.
- `npm run pack` succeeds when a package is requested.
- The user receives a short manual acceptance checklist for testing inside Mulby.
