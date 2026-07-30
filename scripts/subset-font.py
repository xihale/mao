#!/usr/bin/env python3
"""Build a Noto Serif SC woff2 subset covering site content + UI source.

Requires: fonttools (pyftsubset), brotli, and Noto Serif CJK SC on the system
  (e.g. /usr/share/fonts/noto-cjk/NotoSerifCJK-{Regular,SemiBold}.ttc).

Usage:
  python3 scripts/subset-font.py
  python3 scripts/subset-font.py --out-dir /tmp/mao-fonts
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

# Noto Serif CJK TTC face order: JP=0 KR=1 SC=2 TC=3 HK=4
SC_FACE = 2

WEIGHTS = {
    "Regular": {
        "src_names": [
            "NotoSerifCJK-Regular.ttc",
            "NotoSerifCJKsc-Regular.otf",
            "NotoSerifSC-Regular.otf",
        ],
        "out": "NotoSerifSC-Regular.woff2",
    },
    "SemiBold": {
        "src_names": [
            "NotoSerifCJK-SemiBold.ttc",
            "NotoSerifCJKsc-SemiBold.otf",
            "NotoSerifSC-SemiBold.otf",
        ],
        "out": "NotoSerifSC-SemiBold.woff2",
    },
}

FONT_SEARCH_DIRS = [
    Path("/usr/share/fonts/noto-cjk"),
    Path("/usr/share/fonts/opentype/noto"),
    Path("/usr/share/fonts/truetype/noto"),
    Path.home() / ".local/share/fonts",
    Path("/usr/local/share/fonts"),
]

EXTRA_CHARS = (
    " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`"
    "abcdefghijklmnopqrstuvwxyz{|}~"
    "·—…–‐‑‒–—―‘’“”‚„†‡•′″‹›«»"
    "、。，．：；？！「」『』【】〔〕（）［］｛｝《》〈〉﹏＿￥％＃＆＊＋－＝＠＼｜～￣"
    "〇○●■□▲△▼▽◆◇★☆◎※→←↑↓"
    "　"
)


def collect_chars() -> str:
    chars: set[str] = set(EXTRA_CHARS)
    for path in SRC.rglob("*"):
        if path.suffix not in {".md", ".astro", ".ts", ".js", ".mjs", ".css", ".html"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        chars.update(text)

    keep = sorted(
        c
        for c in chars
        if (ord(c) >= 32 and (c.isprintable() or c == "　"))
    )
    return "".join(keep)


def find_source_font(names: list[str]) -> Path:
    for directory in FONT_SEARCH_DIRS:
        if not directory.is_dir():
            continue
        for name in names:
            candidate = directory / name
            if candidate.is_file():
                return candidate
            # recursive fallback (some distros nest deeper)
            for hit in directory.rglob(name):
                if hit.is_file():
                    return hit
    raise FileNotFoundError(
        f"Could not find any of {names} under {FONT_SEARCH_DIRS}"
    )


def subset(src: Path, out: Path, text_file: Path) -> None:
    cmd = [
        "pyftsubset",
        str(src),
        f"--text-file={text_file}",
        f"--output-file={out}",
        "--flavor=woff2",
        "--layout-features=*",
        "--glyph-names",
        "--symbol-cmap",
        "--legacy-cmap",
        "--notdef-glyph",
        "--notdef-outline",
        "--recommended-glyphs",
        "--name-IDs=*",
        "--name-legacy",
        "--name-languages=*",
        "--recalc-bounds",
        "--recalc-timestamp",
    ]
    if src.suffix.lower() == ".ttc":
        cmd.append(f"--font-number={SC_FACE}")

    print(f"  subset {src.name} -> {out.name}")
    subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "build" / "fonts",
        help="Directory for woff2 + zip output (default: build/fonts)",
    )
    args = parser.parse_args()

    if not shutil.which("pyftsubset"):
        print("error: pyftsubset not found (install fonttools)", file=sys.stderr)
        return 1

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    chars = collect_chars()
    text_file = out_dir / "chars.txt"
    text_file.write_text(chars, encoding="utf-8")
    print(f"charset: {len(chars)} unique characters")

    outputs: list[Path] = []
    for weight, meta in WEIGHTS.items():
        src = find_source_font(meta["src_names"])
        print(f"{weight}: source {src}")
        out = out_dir / meta["out"]
        subset(src, out, text_file)
        size_mb = out.stat().st_size / (1024 * 1024)
        print(f"  {out.name}: {size_mb:.2f} MiB")
        outputs.append(out)

    zip_path = out_dir / "fonts-subset.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
        for path in outputs:
            zf.write(path, arcname=path.name)
    print(f"wrote {zip_path} ({zip_path.stat().st_size / (1024 * 1024):.2f} MiB)")
    print("Upload:\n  gh release create fonts build/fonts/fonts-subset.zip --title 'Font subset' --notes 'Noto Serif SC subset (400+600)'")
    print("Or update:\n  gh release upload fonts build/fonts/fonts-subset.zip --clobber")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
