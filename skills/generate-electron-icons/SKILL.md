---
name: generate-electron-icons
description: Generate Windows, macOS, and Linux Electron application icons and tray icons from one or two SVG sources. Use when a repo only has SVG logos, when Electron or electron-builder needs `.ico`, `.icns`, or PNG icon sets, when tray assets such as `iconTemplate.png` or `icon.ico` are missing, or when Codex must batch-convert SVG artwork into ready-to-use multi-size desktop icons.
---

# Generate Electron Icons

Use the bundled scripts instead of ad hoc shell pipelines. The default workflow takes one required app SVG and one optional tray SVG, renders the full Electron icon set, and can also copy the ready-to-use files into an Electron project.

Electron does not define a separate "desktop icon" asset for packaged apps. The desktop shortcut, launcher, Dock, Finder, Explorer, and Start menu entries use the packaged application icon for each platform. This skill therefore exports both the platform package assets and a high-resolution desktop PNG set for preview, launchers, and downstream packaging tasks.

## Workflow

1. Decide whether one SVG is enough.
   - Use one app SVG for everything only when the mark is simple and remains legible at 16px.
   - Use a second tray SVG when the app icon contains text, gradients, shadows, or small interior details.
2. Read [references/platform-requirements.md](references/platform-requirements.md) only if you need to justify sizes, filenames, or platform-specific behavior.
3. Run `scripts/generate_electron_icons.py` with the app SVG and optional tray SVG.
4. Inspect the smallest outputs first: Windows `16x16`, Linux tray `24x24`, macOS `iconTemplate.png`.
5. Inspect the large desktop previews too: `256x256`, `512x512`, `1024x1024`.
6. If the skill is asked to wire icons into an Electron repo, pass `--project-root` so the script copies standard app and tray assets into the project.

## Required Inputs

- `--app-svg`: required; primary app artwork.
- `--tray-svg`: optional; simpler tray artwork. If omitted, the script reuses `--app-svg`.
- `--out-dir`: optional output root. Defaults to `generated-icons`.
- `--project-root`: optional Electron project root. When provided, the script also copies generated assets into `build/` and `resources/tray/`-style locations.

## Standard Command

```bash
python scripts/generate_electron_icons.py \
  --app-svg path/to/app.svg \
  --tray-svg path/to/tray.svg \
  --out-dir generated-icons \
  --project-root path/to/electron-project
```

Important options:

- `--name`: override the output folder name.
- `--app-padding`: transparent padding ratio for app icons. Default `0.08`.
- `--tray-padding`: transparent padding ratio for tray icons. Default `0.06`.
- `--tray-color`: monochrome color for macOS template tray icons. Default `#000000`.
- `--build-resources`: relative app-icon destination under `--project-root`. Default `build`.
- `--tray-resources`: relative tray destination under `--project-root`. Default `resources/tray`.

## Output Contract

The script writes a deterministic folder tree:

- `build/icon.ico`
- `build/icon.icns`
- `build/icon.png`
- `build/icons/desktop/*.png`
- `build/icons/win/*.png`
- `build/icons/linux/*.png`
- `build/icons/mac/icon.iconset/*.png`
- `tray/win/icon.ico`
- `tray/win/icon.png`
- `tray/linux/icon.png`
- `tray/mac/iconTemplate.png`
- `tray/mac/iconTemplate@2x.png`
- `electron-icon-report.json`

When `--project-root` is provided, the script also copies:

- app icons into `<project-root>/<build-resources>/`
- desktop preview PNGs into `<project-root>/<build-resources>/icons/desktop/`
- tray icons into `<project-root>/<tray-resources>/`

## Dependency Rules

- Require `node` and `python`.
- Require Pillow in Python for `.ico` and `.icns` packaging.
- Prefer the target project's `sharp` dependency for SVG rasterization.
- If `sharp` is missing, install it in the target Node project before rerunning. Do not rewrite the rasterizer with browser automation unless the environment blocks `sharp`.

## Quality Checks

- Open or inspect the `16x16`, `24x24`, `32x32`, `256x256`, and `1024x1024` outputs.
- Treat `build/icons/desktop/1024x1024.png` as the canonical large preview for reviews and manual packaging tasks.
- Confirm macOS tray icons are monochrome template images with transparent backgrounds.
- If small sizes blur, rerun with a dedicated tray SVG or increase `--tray-padding`.
- If the project already contains custom tray lookup logic, read that code before deciding which generated files to copy or rename.
