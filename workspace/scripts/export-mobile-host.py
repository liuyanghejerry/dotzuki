#!/usr/bin/env python3
"""Export a shared mobile host around any game's mobile ABI static library."""
import argparse
import html
import json
from pathlib import Path
import re
import shutil

BINARY_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".ttf", ".otf"})


def export_host(platform, library, payload, output, title, bundle):
    workspace = Path(__file__).resolve().parents[1]
    if not library.is_file():
        raise ValueError(f"mobile library missing: {library}")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", bundle):
        raise ValueError("invalid bundle name")
    if output.exists() and any(output.iterdir()):
        raise ValueError("output directory must be empty (protect custom host changes)")
    template = workspace / f"crates/dotzuki-cli/templates/{platform}"
    for source in template.rglob("*"):
        if source.is_file():
            dest = output / source.relative_to(template)
            dest.parent.mkdir(parents=True, exist_ok=True)
            app_name = (
                html.escape(title, quote=True)
                if platform == "android"
                else json.dumps(title, ensure_ascii=False)[1:-1]
            )
            if source.suffix.lower() in BINARY_SUFFIXES:
                # Bitmaps and other binary assets carry no placeholders; a text
                # round-trip would corrupt them.
                shutil.copyfile(source, dest)
                continue
            text = (
                source.read_text()
                .replace("__APP_NAME__", app_name)
                .replace("__BUNDLE_NAME__", bundle)
                .replace("__APPLICATION_ID__", bundle)
            )
            dest.write_text(text)
    if platform == "android":
        raw = output / "app/src/main/res/raw/game.dzpk"
        inc = output / "app/src/main/cpp/include/dotzuki_runner_mobile.h"
        lib = output / "app/src/main/jniLibs/arm64-v8a/libdotzuki_runner_mobile.a"
    else:
        raw = output / "entry/src/main/resources/rawfile/game.dzpk"
        inc = output / "entry/src/main/cpp/include/dotzuki_runner_mobile.h"
        lib = output / "entry/libs/arm64-v8a/libdotzuki_runner_mobile.a"
    raw.parent.mkdir(parents=True, exist_ok=True)
    # ABI startup bytes are opaque to the host. The game factory defines the format.
    raw.write_bytes(payload)
    inc.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(workspace / "crates/dotzuki-mobile/include/dotzuki_runner_mobile.h", inc)
    lib.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(library, lib)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("android", "harmony"), default="harmony")
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--init", required=True, help="UTF-8 initialization bytes for the game factory")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--bundle", required=True)
    args = parser.parse_args()
    export_host(
        args.platform,
        args.library,
        args.init.encode(),
        args.out,
        args.title,
        args.bundle,
    )
