# Electron Icon Requirements

Use this file only when you need platform rationale, size tables, or source links.

## App Icons

Electron packaged apps do not use a second, Electron-specific "desktop icon" asset. Desktop shortcuts and launchers are derived from the packaged app icon for each platform.

### Windows

- Format: `.ico`
- Generate PNG source sizes: `16`, `20`, `24`, `32`, `40`, `48`, `64`, `256`
- Rationale: Microsoft app icon guidance covers these scale targets; bundling them into one `.ico` keeps Windows shell rendering crisp.
- Desktop/start/taskbar note: packaged `.exe` embeds this icon, so Windows desktop shortcuts and Start menu entries reuse it.

### macOS

- Format: `.icon` or `.icns`
- Generate the iconset filenames Apple tooling expects:
  - `icon_16x16.png`
  - `icon_16x16@2x.png`
  - `icon_32x32.png`
  - `icon_32x32@2x.png`
  - `icon_128x128.png`
  - `icon_128x128@2x.png`
  - `icon_256x256.png`
  - `icon_256x256@2x.png`
  - `icon_512x512.png`
  - `icon_512x512@2x.png`
- Effective square sizes: `16`, `32`, `128`, `256`, `512`, `1024`
- Desktop/Dock/Finder note: the app bundle icon is reused by Finder and Dock. Electron Builder currently accepts `.icon` as the preferred modern asset and `.icns` as the legacy asset.

### Linux

- Format: PNG set directory or a single PNG, depending on packaging flow
- Generate common launcher sizes: `16`, `24`, `32`, `48`, `64`, `128`, `256`, `512`
- This is a pragmatic compatibility set, not a strict Electron-only rule. Electron Builder accepts a Linux icon set directory, and freedesktop icon themes commonly use these sizes.
- Desktop launcher note: Linux `.desktop` launchers and app menus use this icon set.

## Desktop Preview Sizes

- Export `256x256`, `512x512`, and `1024x1024` PNG previews in addition to platform package assets.
- Rationale:
  - Electron Builder recommends at least `256x256` for Windows app icons.
  - Electron Builder recommends at least `512x512` for macOS app icons.
  - `1024x1024` is useful as the canonical high-resolution master, matches the largest macOS iconset member, and is a good source for manual store or installer asset derivation.

## Tray Icons

### macOS

- Use template images, not full-color tray artwork.
- Generate:
  - `iconTemplate.png` at `16x16`, `72dpi`
  - `iconTemplate@2x.png` at `32x32`, `144dpi`
- Keep the art monochrome with alpha. The system treats template images specially in menu bars.

### Windows

- Prefer `.ico` for tray usage.
- Generate PNG sources at `16`, `20`, `24`, `32`, `40`, `48`, `64` before packaging the `.ico`.
- Keep a plain `icon.png` fallback as well.

### Linux

- Prefer PNG.
- Electron documents `24x24` as the recommended tray size.
- Generate a compatibility tray set at `16`, `22`, `24`, `32`, `48` because panel size varies across desktop environments.
- The `22px` and `48px` tray variants are an inference for better coverage, not an Electron hard requirement.

## Electron Builder Targets

- macOS app icon: `icon.icon`, `icon.icns`, or `icon.png`
- Windows app icon: `icon.ico`
- Linux app icon: PNG file or icon set directory

## Electron Runtime Notes

- `BrowserWindow` window icons are separate from packaged app icons.
- On Windows and Linux, Electron can set the window icon via `BrowserWindow`/`win.setIcon`.
- On Linux, Electron Packager notes that file-manager icon integration is not handled by the packager; launcher icons come from the platform packaging/icon-set flow.

## Source Links

- Electron Tray API: https://www.electronjs.org/docs/latest/api/tray
- Electron nativeImage: https://www.electronjs.org/docs/latest/api/native-image
- Electron Packager options: https://packages.electronjs.org/packager/v19.0.1/interfaces/Options.html
- Electron Builder Icons: https://www.electron.build/icons
- Microsoft app icon construction: https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-construction
- Apple app icon asset catalog reference: https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/AppIconType.html
- Apple template image guidance: https://developer.apple.com/documentation/uikit/uiimage/renderingmode-swift.enum/alwaystemplate
- freedesktop icon theme specification: https://specifications.freedesktop.org/icon-theme/latest/
