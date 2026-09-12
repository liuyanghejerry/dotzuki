#!/usr/bin/env python3
"""Export the shared Harmony host around any game's mobile ABI static library."""
import argparse
import json
from pathlib import Path
import re
import shutil


def export_host(library, payload, output, title, bundle):
    workspace = Path(__file__).resolve().parents[1]
    if not library.is_file():
        raise ValueError(f"mobile library missing: {library}")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", bundle):
        raise ValueError("invalid bundle name")
    if output.exists() and any(output.iterdir()):
        raise ValueError("output directory must be empty (protect custom host changes)")
    template = workspace / "crates/dotzuki-cli/templates/harmony"
    for source in template.rglob("*"):
        if source.is_file():
            dest = output / source.relative_to(template)
            dest.parent.mkdir(parents=True, exist_ok=True)
            text = source.read_text().replace("__APP_NAME__", json.dumps(title, ensure_ascii=False)[1:-1]).replace("__BUNDLE_NAME__", bundle)
            dest.write_text(text)
    raw = output / "entry/src/main/resources/rawfile/game.dzpk"
    raw.parent.mkdir(parents=True, exist_ok=True)
    # ABI startup bytes are opaque to the host. The game factory defines the format.
    raw.write_bytes(payload)
    inc = output / "entry/src/main/cpp/include/dotzuki_runner_mobile.h"
    inc.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(workspace / "crates/dotzuki-mobile/include/dotzuki_runner_mobile.h", inc)
    lib = output / "entry/libs/arm64-v8a/libdotzuki_runner_mobile.a"
    lib.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(library, lib)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--init", required=True, help="UTF-8 initialization bytes for the game factory")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--bundle", required=True)
    args = parser.parse_args()
    export_host(args.library, args.init.encode(), args.out, args.title, args.bundle)
