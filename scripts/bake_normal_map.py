#!/usr/bin/env python3
"""Bake a tangent-space normal map for the lunar globe from the global LOLA DEM.

Source: ldem_16.img (2880x5760 int16, height = DN * 0.5 m, 16 px/deg equirect,
north at top, lon -180 at left) — same NASA LRO LOLA GDR V2.0 archive as the
site terrain pipeline.

Output: public/textures/moon_normal.png (2048x1024 RGB, OpenGL convention:
+X east, +Y north, +Z out of the surface). Slopes are amplified ~2.5x real so
crater relief reads under grazing light at globe scale.
"""
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "dem" / "ldem_16.img"
OUT = ROOT / "public" / "textures" / "moon_normal.png"

R_MOON = 1_737_400.0
W_OUT, H_OUT = 2048, 1024
STRENGTH = 2.5  # slope amplification (visual)


def main() -> None:
    raw = np.fromfile(SRC, dtype="<i2").reshape(2880, 5760)
    h = raw.astype(np.float32) * 0.5  # meters

    img = Image.fromarray(h, mode="F").resize((W_OUT, H_OUT), Image.LANCZOS)
    h = np.asarray(img, dtype=np.float32)

    m_per_px = 2.0 * np.pi * R_MOON / W_OUT  # equatorial meters per output pixel
    g_east = np.gradient(h, m_per_px, axis=1)  # dh/dx
    g_north = -np.gradient(h, m_per_px, axis=0)  # dh/dy (row 0 = north = +y)

    nx = -g_east * STRENGTH
    ny = g_north * STRENGTH
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + 1.0)
    rgb = np.stack(
        [nx / norm, ny / norm, nz / norm], axis=-1
    ) * 127.5 + 127.5
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    Image.fromarray(rgb, mode="RGB").save(OUT, optimize=True)
    print(f"wrote {OUT.name}: {OUT.stat().st_size / 1e6:.1f} MB ({W_OUT}x{H_OUT})")


if __name__ == "__main__":
    main()
