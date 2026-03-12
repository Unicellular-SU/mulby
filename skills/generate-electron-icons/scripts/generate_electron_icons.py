#!/usr/bin/env python

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, UTC
from pathlib import Path

from PIL import Image

WINDOWS_APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
WINDOWS_TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64]
LINUX_APP_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
LINUX_TRAY_SIZES = [16, 22, 24, 32, 48]
DESKTOP_PREVIEW_SIZES = [256, 512, 1024]
MAC_APP_VARIANTS = [
    ("icon_16x16.png", 16, 72),
    ("icon_16x16@2x.png", 32, 144),
    ("icon_32x32.png", 32, 72),
    ("icon_32x32@2x.png", 64, 144),
    ("icon_128x128.png", 128, 72),
    ("icon_128x128@2x.png", 256, 144),
    ("icon_256x256.png", 256, 72),
    ("icon_256x256@2x.png", 512, 144),
    ("icon_512x512.png", 512, 72),
    ("icon_512x512@2x.png", 1024, 144),
]
MAC_TRAY_VARIANTS = [
    ("iconTemplate.png", 16, 72),
    ("iconTemplate@2x.png", 32, 144),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Electron app icons and tray icons from SVG artwork."
    )
    parser.add_argument("--app-svg", required=True, help="Primary SVG for app icons.")
    parser.add_argument("--tray-svg", help="Optional SVG for tray icons. Defaults to --app-svg.")
    parser.add_argument(
        "--out-dir",
        default="generated-icons",
        help="Directory that will receive the generated icon bundle.",
    )
    parser.add_argument("--name", help="Optional output bundle name.")
    parser.add_argument("--project-root", help="Optional Electron project root for direct file copies.")
    parser.add_argument(
        "--build-resources",
        default="build",
        help="Relative build-resources directory under --project-root.",
    )
    parser.add_argument(
        "--tray-resources",
        default="resources/tray",
        help="Relative tray-assets directory under --project-root.",
    )
    parser.add_argument(
        "--app-padding",
        type=float,
        default=0.08,
        help="Transparent padding ratio per edge for app icons. Default: 0.08",
    )
    parser.add_argument(
        "--tray-padding",
        type=float,
        default=0.06,
        help="Transparent padding ratio per edge for tray icons. Default: 0.06",
    )
    parser.add_argument(
        "--tray-color",
        default="#000000",
        help="Monochrome color for macOS template tray icons. Default: #000000",
    )
    return parser.parse_args()


def ensure_svg(path_value: str) -> Path:
    path = Path(path_value).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"SVG not found: {path}")
    if path.suffix.lower() != ".svg":
        raise ValueError(f"Expected an SVG file, got: {path}")
    return path


def validate_padding(name: str, value: float) -> None:
    if value < 0 or value >= 0.45:
        raise ValueError(f"{name} must be >= 0 and < 0.45, got {value}")


def slugify_name(path: Path) -> str:
    raw = path.stem.strip().lower()
    cleaned = []
    last_hyphen = False
    for char in raw:
        if char.isalnum():
            cleaned.append(char)
            last_hyphen = False
        elif not last_hyphen:
            cleaned.append("-")
            last_hyphen = True
    name = "".join(cleaned).strip("-")
    return name or "electron-icons"


def build_output_paths(root: Path) -> dict[str, Path]:
    return {
        "bundle": root,
        "build_root": root / "build",
        "desktop_previews": root / "build" / "icons" / "desktop",
        "win_app_sizes": root / "build" / "icons" / "win",
        "linux_app_sizes": root / "build" / "icons" / "linux",
        "mac_iconset": root / "build" / "icons" / "mac" / "icon.iconset",
        "tray_root": root / "tray",
        "win_tray_sizes": root / "tray" / "win" / "sizes",
        "linux_tray_sizes": root / "tray" / "linux" / "sizes",
        "mac_tray": root / "tray" / "mac",
        "report": root / "electron-icon-report.json",
    }


def render_all_svg_variants(
    skill_dir: Path,
    app_svg: Path,
    tray_svg: Path,
    output_paths: dict[str, Path],
    app_padding: float,
    tray_padding: float,
    tray_color: str,
    sharp_root: Path,
) -> None:
    jobs: list[dict[str, object]] = []

    for size in WINDOWS_APP_SIZES:
        jobs.append(
            {
                "source": str(app_svg),
                "output": str(output_paths["win_app_sizes"] / f"{size}x{size}.png"),
                "size": size,
                "padding": app_padding,
                "density": 1024,
            }
        )

    for size in DESKTOP_PREVIEW_SIZES:
        jobs.append(
            {
                "source": str(app_svg),
                "output": str(output_paths["desktop_previews"] / f"{size}x{size}.png"),
                "size": size,
                "padding": app_padding,
                "density": 1024,
            }
        )

    for size in LINUX_APP_SIZES:
        jobs.append(
            {
                "source": str(app_svg),
                "output": str(output_paths["linux_app_sizes"] / f"{size}x{size}.png"),
                "size": size,
                "padding": app_padding,
                "density": 1024,
            }
        )

    for filename, size, dpi in MAC_APP_VARIANTS:
        jobs.append(
            {
                "source": str(app_svg),
                "output": str(output_paths["mac_iconset"] / filename),
                "size": size,
                "padding": app_padding,
                "density": 1024,
                "dpi": dpi,
            }
        )

    for size in WINDOWS_TRAY_SIZES:
        jobs.append(
            {
                "source": str(tray_svg),
                "output": str(output_paths["win_tray_sizes"] / f"{size}x{size}.png"),
                "size": size,
                "padding": tray_padding,
                "density": 768,
            }
        )

    for size in LINUX_TRAY_SIZES:
        jobs.append(
            {
                "source": str(tray_svg),
                "output": str(output_paths["linux_tray_sizes"] / f"{size}x{size}.png"),
                "size": size,
                "padding": tray_padding,
                "density": 768,
            }
        )

    for filename, size, dpi in MAC_TRAY_VARIANTS:
        jobs.append(
            {
                "source": str(tray_svg),
                "output": str(output_paths["mac_tray"] / filename),
                "size": size,
                "padding": tray_padding,
                "density": 768,
                "dpi": dpi,
                "mode": "monochrome",
                "color": tray_color,
            }
        )

    spec_path = output_paths["bundle"] / ".render-spec.json"
    spec_path.write_text(json.dumps({"jobs": jobs}, indent=2), encoding="utf8")
    env = os.environ.copy()
    env["ELECTRON_ICON_SHARP_ROOT"] = str(sharp_root)
    try:
        subprocess.run(
            [
                "node",
                str(skill_dir / "scripts" / "render_svg_variants.mjs"),
                "--spec",
                str(spec_path),
            ],
            check=True,
            env=env,
        )
    finally:
        if spec_path.exists():
            spec_path.unlink()


def save_ico(source_png: Path, destination: Path, sizes: list[int]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_png) as image:
        image.convert("RGBA").save(
            destination,
            format="ICO",
            sizes=[(size, size) for size in sizes],
        )


def save_icns(source_png: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    icns_sizes = [16, 32, 64, 128, 256, 512, 1024]
    with Image.open(source_png) as image:
        image.convert("RGBA").save(
            destination,
            format="ICNS",
            sizes=[(size, size) for size in icns_sizes],
        )


def copy_file(source: Path, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return str(destination)


def copy_outputs_into_project(
    output_paths: dict[str, Path],
    project_root: Path,
    build_resources: str,
    tray_resources: str,
) -> dict[str, str]:
    build_dir = project_root / build_resources
    tray_dir = project_root / tray_resources

    copied = {
        "build/icon.ico": copy_file(output_paths["build_root"] / "icon.ico", build_dir / "icon.ico"),
        "build/icon.icns": copy_file(output_paths["build_root"] / "icon.icns", build_dir / "icon.icns"),
        "build/icon.png": copy_file(output_paths["build_root"] / "icon.png", build_dir / "icon.png"),
        "tray/icon.ico": copy_file(output_paths["tray_root"] / "win" / "icon.ico", tray_dir / "icon.ico"),
        "tray/icon.png": copy_file(output_paths["tray_root"] / "linux" / "icon.png", tray_dir / "icon.png"),
        "tray/iconTemplate.png": copy_file(
            output_paths["tray_root"] / "mac" / "iconTemplate.png",
            tray_dir / "iconTemplate.png",
        ),
        "tray/iconTemplate@2x.png": copy_file(
            output_paths["tray_root"] / "mac" / "iconTemplate@2x.png",
            tray_dir / "iconTemplate@2x.png",
        ),
    }

    linux_icons_target = build_dir / "icons" / "linux"
    if linux_icons_target.exists():
        shutil.rmtree(linux_icons_target)
    shutil.copytree(output_paths["linux_app_sizes"], linux_icons_target)
    copied["build/icons/linux"] = str(linux_icons_target)

    desktop_icons_target = build_dir / "icons" / "desktop"
    if desktop_icons_target.exists():
        shutil.rmtree(desktop_icons_target)
    shutil.copytree(output_paths["desktop_previews"], desktop_icons_target)
    copied["build/icons/desktop"] = str(desktop_icons_target)
    return copied


def write_report(
    destination: Path,
    args: argparse.Namespace,
    app_svg: Path,
    tray_svg: Path,
    bundle_root: Path,
    copied_files: dict[str, str],
) -> None:
    report = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "inputs": {
            "appSvg": str(app_svg),
            "traySvg": str(tray_svg),
            "appPadding": args.app_padding,
            "trayPadding": args.tray_padding,
            "trayColor": args.tray_color,
        },
        "bundleRoot": str(bundle_root),
        "outputs": {
            "desktopPreviewDir": str(bundle_root / "build" / "icons" / "desktop"),
            "appWindowsIco": str(bundle_root / "build" / "icon.ico"),
            "appMacIcns": str(bundle_root / "build" / "icon.icns"),
            "appLinuxDir": str(bundle_root / "build" / "icons" / "linux"),
            "trayWindowsIco": str(bundle_root / "tray" / "win" / "icon.ico"),
            "trayLinuxPng": str(bundle_root / "tray" / "linux" / "icon.png"),
            "trayMacTemplate": str(bundle_root / "tray" / "mac" / "iconTemplate.png"),
            "trayMacTemplate2x": str(bundle_root / "tray" / "mac" / "iconTemplate@2x.png"),
        },
        "copiedIntoProject": copied_files,
        "recommendedElectronBuilderConfig": {
            "directories": {"buildResources": args.build_resources},
            "mac": {"icon": f"{args.build_resources}/icon.icns"},
            "win": {"icon": f"{args.build_resources}/icon.ico"},
            "linux": {"icon": f"{args.build_resources}/icons/linux"},
        },
        "notes": [
            "Desktop shortcuts and launchers reuse the packaged app icon; Electron does not define a second desktop-only icon asset.",
            "Use a dedicated tray SVG when the app icon has text or fine detail.",
            "macOS tray assets are exported as monochrome template images.",
            "Linux tray exact display size varies by desktop environment; 24px is the default export.",
        ],
    }
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf8")


def main() -> int:
    args = parse_args()
    app_svg = ensure_svg(args.app_svg)
    tray_svg = ensure_svg(args.tray_svg) if args.tray_svg else app_svg
    validate_padding("app-padding", args.app_padding)
    validate_padding("tray-padding", args.tray_padding)

    skill_dir = Path(__file__).resolve().parent.parent
    bundle_name = args.name or slugify_name(app_svg)
    bundle_root = Path(args.out_dir).expanduser().resolve() / bundle_name
    output_paths = build_output_paths(bundle_root)

    for directory in output_paths.values():
        if directory.suffix:
            directory.parent.mkdir(parents=True, exist_ok=True)
        else:
            directory.mkdir(parents=True, exist_ok=True)

    sharp_root = Path(args.project_root).expanduser().resolve() if args.project_root else Path.cwd().resolve()
    render_all_svg_variants(
        skill_dir=skill_dir,
        app_svg=app_svg,
        tray_svg=tray_svg,
        output_paths=output_paths,
        app_padding=args.app_padding,
        tray_padding=args.tray_padding,
        tray_color=args.tray_color,
        sharp_root=sharp_root,
    )

    build_root = output_paths["build_root"]
    tray_root = output_paths["tray_root"]

    shutil.copy2(output_paths["linux_app_sizes"] / "512x512.png", build_root / "icon.png")
    shutil.copy2(output_paths["win_tray_sizes"] / "32x32.png", tray_root / "win" / "icon.png")
    shutil.copy2(output_paths["linux_tray_sizes"] / "24x24.png", tray_root / "linux" / "icon.png")

    save_ico(output_paths["mac_iconset"] / "icon_512x512@2x.png", build_root / "icon.ico", WINDOWS_APP_SIZES)
    save_icns(output_paths["mac_iconset"] / "icon_512x512@2x.png", build_root / "icon.icns")
    save_ico(output_paths["win_tray_sizes"] / "64x64.png", tray_root / "win" / "icon.ico", WINDOWS_TRAY_SIZES)

    copied_files: dict[str, str] = {}
    if args.project_root:
        project_root = Path(args.project_root).expanduser().resolve()
        copied_files = copy_outputs_into_project(
            output_paths=output_paths,
            project_root=project_root,
            build_resources=args.build_resources,
            tray_resources=args.tray_resources,
        )

    write_report(
        destination=output_paths["report"],
        args=args,
        app_svg=app_svg,
        tray_svg=tray_svg,
        bundle_root=bundle_root,
        copied_files=copied_files,
    )

    print(f"Generated Electron icons in: {bundle_root}")
    print(f"Desktop PNGs: {output_paths['desktop_previews']}")
    print(f"App ICO:   {build_root / 'icon.ico'}")
    print(f"App ICNS:  {build_root / 'icon.icns'}")
    print(f"Tray ICO:  {tray_root / 'win' / 'icon.ico'}")
    print(f"Tray PNG:  {tray_root / 'linux' / 'icon.png'}")
    print(f"Tray Mac:  {tray_root / 'mac' / 'iconTemplate.png'}")
    if copied_files:
        print(f"Copied project assets into: {Path(args.project_root).expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # pragma: no cover - CLI surface
        print(f"[generate_electron_icons] {error}", file=sys.stderr)
        raise SystemExit(1)
