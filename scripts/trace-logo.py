#!/usr/bin/env python3
"""Trace logo to SVG for smooth, resolution-independent edges."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "assets" / "logo" / "logo-transparent.png"
FALLBACK_SOURCE = REPO_ROOT / "logo"
OUTPUT_DIR = REPO_ROOT / "assets" / "logo"
VIEW_SIZE = 1280
UPSCALE = 4

INK_COLORS = {
    "black": "#000000",
    "off-black": "#1a1a1a",
    "gray": "#888888",
    "off-white": "#f5f3ee",
    "white": "#ffffff",
}


def prepare_trace_input(path: Path) -> tuple[Path, int]:
    img = Image.open(path).convert("RGBA")
    size = (img.width * UPSCALE, img.height * UPSCALE)
    img = img.resize(size, Image.Resampling.LANCZOS)

    # Flatten onto white so vtracer sees crisp black shapes (preserves eye holes).
    flat = Image.new("RGB", size, (255, 255, 255))
    flat.paste(img, mask=img.split()[3])
    flat = flat.filter(ImageFilter.GaussianBlur(radius=0.6))
    flat = flat.point(lambda value: 0 if value < 128 else 255)

    tmp = Path(tempfile.mkstemp(suffix=".png")[1])
    flat.save(tmp)
    return tmp, size[0]


def trace_to_svg(input_path: Path, output: Path) -> None:
    vtracer = shutil.which("vtracer")
    if not vtracer:
        raise RuntimeError("vtracer not found; install with: cargo install vtracer")

    subprocess.run(
        [
            vtracer,
            "-i",
            str(input_path),
            "-o",
            str(output),
            "--preset",
            "bw",
            "--mode",
            "spline",
            "-f",
            "12",
            "-c",
            "80",
            "-l",
            "4.0",
            "--path_precision",
            "1",
        ],
        check=True,
    )


def normalize_svg(svg_path: Path, source_size: int, view_size: int = VIEW_SIZE) -> None:
    text = svg_path.read_text()
    scale = view_size / source_size

    def scale_transform(match: re.Match[str]) -> str:
        prefix, values = match.group(1), match.group(2)
        nums = [float(value) for value in re.findall(r"-?\d*\.?\d+", values)]
        scaled = [num * scale for num in nums]
        if prefix == "matrix(" and len(scaled) == 6:
            scaled[0] *= 1
            scaled[3] *= 1
        joined = " ".join(
            str(int(value)) if value.is_integer() else f"{value:.2f}".rstrip("0").rstrip(".")
            for value in scaled
        )
        return f'{prefix}{joined})'

    if scale != 1:
        text = re.sub(
            r'(translate\()([^)]+)\)',
            scale_transform,
            text,
        )

    text = re.sub(r'width="[^"]+"', f'width="{view_size}"', text, count=1)
    text = re.sub(r'height="[^"]+"', f'height="{view_size}"', text, count=1)
    if "viewBox=" not in text:
        text = text.replace(
            f'width="{view_size}"',
            f'width="{view_size}" viewBox="0 0 {view_size} {view_size}"',
            1,
        )
    else:
        text = re.sub(
            r'viewBox="[^"]+"',
            f'viewBox="0 0 {view_size} {view_size}"',
            text,
            count=1,
        )

    svg_path.write_text(text)


def write_color_variant(master: Path, name: str, ink: str) -> None:
    text = master.read_text()
    text = text.replace('fill="#000000"', f'fill="{ink}"')
    text = text.replace('fill="#FFFFFF"', 'fill="#ffffff"')
    (OUTPUT_DIR / f"logo-{name}.svg").write_text(text)


def resolve_source() -> Path:
    if SOURCE.exists():
        return SOURCE
    if FALLBACK_SOURCE.exists():
        return FALLBACK_SOURCE
    raise SystemExit(
        f"No logo source found. Run `npm run logo:process` first, or add {FALLBACK_SOURCE}"
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source = resolve_source()

    trace_input, trace_size = prepare_trace_input(source)
    master = OUTPUT_DIR / "logo.svg"
    try:
        trace_to_svg(trace_input, master)
    finally:
        trace_input.unlink(missing_ok=True)

    normalize_svg(master, trace_size)

    for name, color in INK_COLORS.items():
        write_color_variant(master, name, color)

    print(f"Source: {source}")
    print(f"Trace input: {trace_size}x{trace_size}px")
    print(f"Output: {OUTPUT_DIR}/")
    for path in sorted(OUTPUT_DIR.glob("logo*.svg")):
        print(f"  {path.name} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
