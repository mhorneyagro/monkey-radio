#!/usr/bin/env python3
"""Upscale logo, remove background, export color variants."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "logo"
OUTPUT_DIR = REPO_ROOT / "assets" / "logo"
SCALE = 8  # 160 -> 1280px

VARIANTS = {
  "black": (0, 0, 0),
  "off-black": (26, 26, 26),
  "dark-gray": (80, 80, 80),
  "gray": (136, 136, 136),
    "off-white": (245, 243, 238),
    "white": (255, 255, 255),
}


def upscale(img: Image.Image) -> Image.Image:
    size = (img.width * SCALE, img.height * SCALE)
    return img.resize(size, Image.Resampling.LANCZOS)


def classify_pixels(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return masks for background, foreground (ink), and inner white."""
    luminance = (
        0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    )
    h, w = luminance.shape
    background = np.zeros((h, w), dtype=bool)
    visited = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and not visited[y, x]:
            if luminance[y, x] > 200:
                visited[y, x] = True
                queue.append((y, x))

    for x in range(w):
        enqueue(0, x)
        enqueue(h - 1, x)
    for y in range(h):
        enqueue(y, 0)
        enqueue(y, w - 1)

    while queue:
        y, x = queue.popleft()
        background[y, x] = True
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            enqueue(y + dy, x + dx)

    foreground = (~background) & (luminance < 120)
    inner_white = (~background) & (~foreground)
    return background, foreground, inner_white


def build_rgba(
    foreground: np.ndarray,
    inner_white: np.ndarray,
    ink_rgb: tuple[int, int, int],
) -> Image.Image:
    h, w = foreground.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[foreground] = (*ink_rgb, 255)
    rgba[inner_white] = (255, 255, 255, 255)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    original = Image.open(SOURCE).convert("RGB")
    upscaled = upscale(original)
    rgb = np.array(upscaled)
    background, foreground, inner_white = classify_pixels(rgb)

    # Master transparent PNG (original black ink)
    master = build_rgba(foreground, inner_white, VARIANTS["black"])
    master_path = OUTPUT_DIR / "logo-transparent.png"
    master.save(master_path, "PNG")

    # Upscaled source copy (no transparency)
    upscaled.save(OUTPUT_DIR / "logo-upscaled.jpg", "JPEG", quality=95)

    for name, color in VARIANTS.items():
        variant = build_rgba(foreground, inner_white, color)
        variant.save(OUTPUT_DIR / f"logo-{name}.png", "PNG")

    # Preview sheets on dark and light backgrounds
    for bg_name, bg_color in (("dark", (11, 13, 18)), ("light", (245, 243, 238))):
        sheet = Image.new("RGB", (master.width * 2, master.height * 2), bg_color)
        for i, name in enumerate(VARIANTS):
            variant = Image.open(OUTPUT_DIR / f"logo-{name}.png")
            x = (i % 2) * master.width
            y = (i // 2) * master.height
            sheet.paste(variant, (x, y), variant)
        sheet.save(OUTPUT_DIR / f"preview-{bg_name}.jpg", "JPEG", quality=95)

    print(f"Source: {SOURCE} ({original.width}x{original.height})")
    print(f"Upscaled: {master.width}x{master.height}")
    print(f"Output: {OUTPUT_DIR}/")
    for path in sorted(OUTPUT_DIR.glob("logo-*.png")):
        print(f"  {path.name}")


if __name__ == "__main__":
    main()
