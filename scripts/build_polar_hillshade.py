#!/usr/bin/env python3
"""Render a polar azimuthal equidistant LOLA hillshade for the regional atlas.

Output: public/textures/polar_hillshade.png — a square image whose full disc
is the lunar south cap from 84°S to the pole, pole at centre, 0°E up, same
linear-radius projection the map canvas uses (radius ∝ 84°S→90°S).

Requires data/dem/ldem_75s_120m.img (local, gitignored). Usage:
    python scripts/build_polar_hillshade.py [size_px]
"""
import json
import math
import pathlib
import sys

import numpy as np

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required: pip install pillow numpy")

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEM = ROOT / "data" / "dem" / "ldem_75s_120m.img"
OUT = ROOT / "public" / "textures" / "polar_hillshade.png"

M_PER_PX = 120.0
R_REF = 1_737_400.0  # metres
RIM_LAT = -84.0  # the map's rim latitude


def load_dem(path: pathlib.Path):
    raw = np.fromfile(path, dtype="<i2")
    n = int(round(np.sqrt(raw.size)))
    if n * n != raw.size:
        raise ValueError(f"{path.name}: not square ({raw.size})")
    return raw.reshape(n, n), n / 2.0 - 0.5


def px_to_latlon(sample, line, off):
    x = (sample - off) * M_PER_PX
    y = (off - line) * M_PER_PX
    rho = np.hypot(x, y)
    lat = -90.0 + 2.0 * np.degrees(np.arctan2(rho, 2.0 * R_REF))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def latlon_to_px(lat_deg, lon_deg, off):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    rho = 2.0 * R_REF * np.tan(np.pi / 4.0 + lat / 2.0)
    x = rho * np.sin(lon)
    y = rho * np.cos(lon)
    return off + x / M_PER_PX, off - y / M_PER_PX


def bilinear(dem, sample, line):
    n = dem.shape[0]
    x = np.clip(sample, 0, n - 1 - 1e-6).ravel()
    y = np.clip(line, 0, n - 1 - 1e-6).ravel()
    x0 = x.astype(np.intp)
    y0 = y.astype(np.intp)
    fx = x - x0
    fy = y - y0
    h00 = dem[y0, x0].astype(np.float64)
    h10 = dem[y0, x0 + 1].astype(np.float64)
    h01 = dem[y0 + 1, x0].astype(np.float64)
    h11 = dem[y0 + 1, x0 + 1].astype(np.float64)
    out = (h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) +
           h01 * (1 - fx) * fy + h11 * fx * fy) * 0.5  # metres
    return out.reshape(np.shape(sample))


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Separable box blur via cumsum (radius r pixels, two passes)."""
    def blur1d(arr: np.ndarray, axis: int) -> np.ndarray:
        pad = [(0, 0)] * arr.ndim
        pad[axis] = (r, r)
        p = np.pad(arr, pad, mode="edge")
        c = np.cumsum(p, axis=axis)
        z = np.zeros([1 if k == axis else c.shape[k] for k in range(c.ndim)])
        c0 = np.concatenate([z, c], axis=axis)
        W = arr.shape[axis]
        hi = [slice(None)] * arr.ndim
        lo = [slice(None)] * arr.ndim
        hi[axis] = slice(2 * r + 1, 2 * r + 1 + W)
        lo[axis] = slice(0, W)
        return (c0[tuple(hi)] - c0[tuple(lo)]) / (2 * r + 1)
    return blur1d(blur1d(a, 0), 1)


def main():
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
    dem, off = load_dem(DEM)
    W = size

    # output pixel -> fractional map radius (0 = pole, 1 = 84S rim) -> lat/lon
    jj, ii = np.mgrid[0:W, 0:W]
    dx = ii - (W - 1) / 2.0
    dy = (W - 1) / 2.0 - jj  # 0°E points up
    rr_raw = np.hypot(dx, dy)
    frac = np.clip(rr_raw / ((W - 1) / 2.0), 0, 1)
    lat = -90.0 + 6.0 * frac
    lon = np.degrees(np.arctan2(dx, dy))

    sample, line = latlon_to_px(lat, lon, off)
    # the square's corners extend past the rim/pole: cut them so the map
    # canvas renders only the true circular cap
    inside = (rr_raw <= (W - 1) / 2.0 + 1) & (sample >= 1) & (sample < dem.shape[0] - 2) & (line >= 1) & (line < dem.shape[0] - 2)
    sample_c = np.clip(sample, 1, dem.shape[0] - 2)
    line_c = np.clip(line, 1, dem.shape[0] - 2)

    step = R_REF * math.radians(12) / (W - 1) # output ground metres per pixel
    h = box_blur(bilinear(dem, sample_c, line_c), 1)
    gy, gx = np.gradient(h, step)

    # surface normal of the tilted plane; light from NW at 45 deg
    lx, ly, lz = -0.5, -0.5, math.sqrt(0.5)
    shade = np.clip((-gx * lx - gy * ly + lz) / np.sqrt(gx * gx + gy * gy + 1), 0, 1)

    # exaggerate relief a touch, cool-tinted grayscale
    v = 0.25 + 0.75 * np.power(shade, 1.4)
    r = (v * 168).astype(np.uint8)
    g = (v * 182).astype(np.uint8)
    b = (np.clip(v * 1.06, 0, 1) * 205).astype(np.uint8)

    alpha = np.where(inside, 255, 0).astype(np.uint8)

    print('shapes', h.shape, gx.shape, shade.shape, v.shape, alpha.shape)
    rgb = np.dstack([r, g, b, alpha])
    img = Image.fromarray(rgb, "RGBA")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT.name} ({W}x{W})")

    # 16-bit heightmap (R = high byte, G = low byte) for 3D displacement,
    # same projection/extent as the hillshade
    hmin = float(h[inside].min())
    hmax = float(h[inside].max())
    v16 = np.clip((h - hmin) / (hmax - hmin) * 65535, 0, 65535).astype(np.uint32)
    hm = np.zeros((W, W, 3), dtype=np.uint8)
    hm[..., 0] = (v16 >> 8) & 0xFF
    hm[..., 1] = v16 & 0xFF
    hm[..., 2] = 0
    hout = ROOT / "public" / "textures" / "polar_heightmap.png"
    Image.fromarray(hm, "RGB").save(hout, optimize=True)
    meta = {"minM": round(hmin, 1), "maxM": round(hmax, 1), "size": W,
            "projection": "south polar azimuthal equidistant", "centerLat": -90, "edgeLat": -84,
            "longitudeZero": "up", "longitudeDirection": "clockwise",
            "illumination": "illustrative northwest light at 45 degrees; not current sunlight",
            "source": "LRO LOLA LDEM_75S_120M; pixel centers (N-1)/2"}
    (ROOT / "public" / "textures" / "polar_heightmeta.json").write_text(json.dumps(meta))
    print(f"wrote polar_heightmap.png + meta {meta}")


if __name__ == "__main__":
    main()
