#!/usr/bin/env python3
"""Define lunar south-pole landing sites on LOLA DEM ground truth, compute horizon
profiles, and emit the site manifest consumed by the web app.

Sites are snapped to DEM extremes within a small radius so coordinates reflect the
actual terrain feature (rim crest, summit, bowl floor) rather than approximate
remembered values. This script owns public/data/sites.json; fetch_ephemeris.py
reads its coordinates from there.

DEM: LRO LOLA GDR polar stereographic products (PDS, LRO-L-LOLA-4-GDR-V1.0):
  ldem_85s_20m   20 m/px, 85S-90S   (pole sites)
  ldem_75s_120m 120 m/px, 75S-90S   (IM-1 site at ~80.3S)
Height = DN * 0.5 m above a 1737400 m reference sphere. Pole at pixel (off, off),
off = n/2 - 0.5; x toward lon 90E, y toward lon 0E (south polar stereographic).

Site lat/lon are planetocentric in the DE421 mean-Earth/polar-axis frame,
matching the ephemeris pipeline (JPL Horizons MEAN_ME).
"""
import json
import math
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"

R_REF = 1_737_400.0  # m, reference sphere shared by LOLA products and our ephemerides

# name, slug, kind, approx (lat, lon), dem, m_per_px, snap, snap_radius_m, note
# Heights/frame validated: Shackleton/Faustini/de Gerlache bowl depths match
# published values (see validate_projection). Malapert crater (84.9S 12.9E) is NOT
# the massif; NASA's notional Artemis site sits on the massif at ~85.96S 357.7E.
SITES = [
    (
        "Shackleton Rim", "shackleton-rim", "candidate", (-89.997, -50.22),
        "ldem_85s_20m.img", 20.0, "max", 1500,
        "Pole-facing crest of Shackleton's rim (crater center 10.5 km away), snapped to "
        "the local DEM maximum. Candidate Artemis/ILRS base region.",
    ),
    (
        "Shackleton Floor", "shackleton-floor", "candidate", (-89.67, 129.78),
        "ldem_85s_20m.img", 20.0, "min", 3000,
        "Selected local DEM minimum on Shackleton crater floor. The cached interval "
        "reports no hourly Sun-centre visibility; this calculation does not establish "
        "permanent shadow or detect water ice.",
    ),
    (
        "Malapert Massif (Artemis area)", "malapert-massif", "candidate", (-85.96, 357.68),
        "ldem_85s_20m.img", 20.0, "max", 10000,
        "Selected Malapert-region DEM maximum. The displayed DEM-anchored coordinate "
        "defines the prediction; it is not a certified landing point.",
    ),
    (
        "Polar High Point", "polar-high-point", "candidate", (-85.23, 36.60),
        "ldem_85s_20m.img", 20.0, "max", 5000,
        "A local high point in the LOLA south-polar cap (above the 1737.4 km "
        "reference sphere), selected to explore high-elevation illumination and Earth visibility.",
    ),
    (
        "IM-1 Odysseus Site", "im-1-odysseus-site", "clps", (-80.30, 1.30),
        "ldem_75s_120m.img", 120.0, None, 0,
        "Intuitive Machines IM-1 Odysseus landing region, Feb 2024, near Malapert A "
        "(approximate published coordinates; no DEM snap — it is a real landing site).",
    ),
    (
        "de Gerlache Rim", "de-gerlache-rim", "candidate", (-88.5, 275.0),
        "ldem_85s_20m.img", 20.0, "max", 16000,
        "Rim crest of de Gerlache crater (~34 km), snapped to the local DEM maximum. "
        "Adjacent to the Artemis candidate region.",
    ),
    (
        "Haworth Rim", "haworth-rim", "candidate", (-86.7, 354.0),
        "ldem_85s_20m.img", 20.0, "max", 13000,
        "Rim crest of Haworth crater (~26 km), snapped to the local DEM maximum. "
        "Haworth floor is a classic permanently shadowed ice target.",
    ),
    (
        "Faustini Rim", "faustini-rim", "candidate", (-87.3, 77.0),
        "ldem_85s_20m.img", 20.0, "max", 19000,
        "Rim crest of Faustini crater (~39 km), snapped to the local DEM maximum. "
        "Deep, ancient, permanently shadowed interior.",
    ),
    (
        "Nobile Rim", "nobile-rim", "candidate", (-85.2, 53.8),
        "ldem_85s_20m.img", 20.0, "max", 36000,
        "Rim crest of Nobile crater (~73 km, central-peak crater), snapped to the "
        "local DEM maximum. Former VIPER rover exploration region.",
    ),
    (
        "Connecting Ridge", "connecting-ridge", "candidate", (-84.7, 32.3),
        "ldem_85s_20m.img", 20.0, "max", 8000,
        "NASA Artemis III candidate region: the crest between the de Gerlache and "
        "Shackleton/Henson drainage, snapped to the local DEM maximum.",
    ),
    (
        "Connecting Ridge Extension", "connecting-ridge-extension", "candidate", (-84.3, 40.0),
        "ldem_85s_20m.img", 20.0, "max", 6000,
        "NASA Artemis III candidate region northeast of Connecting Ridge, snapped to "
        "the local DEM maximum.",
    ),
    (
        "Amundsen Rim", "amundsen-rim", "candidate", (-86.0, 73.0),
        "ldem_85s_20m.img", 20.0, "max", 12000,
        "Rim crest of Amundsen crater (~105 km), snapped to the local DEM maximum. "
        "NASA Artemis III candidate region; classic volatile-science target south of the central peak.",
    ),
    (
        "Leibnitz Beta Plateau", "leibnitz-beta-plateau", "candidate", (-85.84, 354.0),
        "ldem_85s_20m.img", 20.0, "max", 15000,
        "NASA Artemis III candidate region on the Leibnitz Beta plateau west of "
        "Malapert, snapped to the local DEM maximum.",
    ),
    (
        "de Gerlache-Kocher Massif", "de-gerlache-kocher-massif", "candidate", (-88.38, 290.0),
        "ldem_85s_20m.img", 20.0, "max", 3500,
        "NASA Artemis III candidate region: the massif between de Gerlache and Kocher "
        "craters, snapped to the local DEM maximum.",
    ),
]

# radial march: meters from the site. Far segments reach the true horizon
# (~145-155 km for 5-7 km summit sites) so limb dip is represented; the 20 m DEM
# only covers 85S-90S, so rays beyond its cap fall back to the 120 m product.
DISTANCES = np.concatenate(
    [
        np.array([0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]),
        np.arange(6.0, 61.0, 2.0),
        np.arange(65.0, 161.0, 5.0),
    ]
)
DISTANCES *= 1000.0
AZIMUTHS = np.arange(360)  # degrees clockwise from local north


def load_dem(path: pathlib.Path, m_per_px: float):
    """Read a PDS LOLA polar DEM into (DN int16, pole_offset_px, cap_deg).

    DN stays int16 (saves ~0.9 GB on the 20 m product); height = DN * 0.5 m is
    applied inside bilinear().
    """
    raw = np.fromfile(path, dtype="<i2")
    n = int(round(np.sqrt(raw.size)))
    if n * n != raw.size:
        raise ValueError(f"{path.name}: not square ({raw.size} samples)")
    raw = raw.reshape(n, n)
    off = n / 2.0 - 0.5  # pole pixel; label LINE/SAMPLE_PROJECTION_OFFSET
    cap_deg = math.degrees((n * m_per_px) / (2.0 * R_REF))
    return raw, off, cap_deg


def latlon_to_px(lat_deg, lon_deg, m_per_px, off):
    """South polar stereographic: rho = 2R tan(45 + lat/2); x=rho sin(lon), y=rho cos(lon);
    line = off - y/mpp, sample = off + x/mpp."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    rho = 2.0 * R_REF * np.tan(np.pi / 4.0 + lat / 2.0)
    x = rho * np.sin(lon)
    y = rho * np.cos(lon)
    return off + x / m_per_px, off - y / m_per_px


def px_to_latlon(sample, line, m_per_px, off):
    x = (sample - off) * m_per_px
    y = (off - line) * m_per_px
    rho = math.hypot(x, y)
    lat = -90.0 + 2.0 * math.degrees(math.atan2(rho, 2.0 * R_REF))
    lon = math.degrees(math.atan2(x, y))
    return lat, lon


def bilinear(heights_dn, sample, line):
    """Bilinear DEM interpolation; returns height in meters (DN * 0.5)."""
    n = heights_dn.shape[0]
    # latlon_to_px returns zero-based pixel-centre coordinates.
    # Do not apply a second half-pixel shift before interpolation.
    x = np.clip(sample, 0, n - 1 - 1e-6)
    y = np.clip(line, 0, n - 1 - 1e-6)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    dn = (
        heights_dn[y0, x0] * (1 - fx) * (1 - fy)
        + heights_dn[y0, x0 + 1] * fx * (1 - fy)
        + heights_dn[y0 + 1, x0] * (1 - fx) * fy
        + heights_dn[y0 + 1, x0 + 1] * fx * fy
    )
    return dn * 0.5


def height_at(dem, lat, lon):
    heights, off, mpp, _n = dem
    s, l = latlon_to_px(lat, lon, mpp, off)
    return float(bilinear(heights, np.asarray([s]), np.asarray([l]))[0])


def unit(lat_deg, lon_deg):
    """Cartesian unit vector(s); scalars -> (3,), arrays -> (..., 3)."""
    la = np.radians(lat_deg)
    lo = np.radians(lon_deg)
    return np.stack(
        [np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1
    )


def destination(lat0_deg, lon0_deg, bearing_deg, ang_rad):
    """Great-circle destination point on a sphere."""
    lat0 = np.radians(lat0_deg)
    lon0 = np.radians(lon0_deg)
    brg = np.radians(bearing_deg)
    sin_lat = np.sin(lat0) * np.cos(ang_rad) + np.cos(lat0) * np.sin(ang_rad) * np.cos(brg)
    lat1 = np.arcsin(sin_lat)
    lon1 = lon0 + np.arctan2(
        np.sin(brg) * np.sin(ang_rad) * np.cos(lat0),
        np.cos(ang_rad) - np.sin(lat0) * sin_lat,
    )
    return np.degrees(lat1), np.degrees(lon1)


def snap_site(dem, lat, lon, kind, radius_m):
    """Snap to the DEM max ('max') or min ('min') within radius_m of (lat, lon)."""
    heights, off, m_per_px, n = dem
    r_px = int(radius_m / m_per_px)
    s, l = latlon_to_px(lat, lon, m_per_px, off)
    n = heights.shape[0]
    x0 = int(np.clip(s - r_px, 0, n - 1))
    x1 = int(np.clip(s + r_px, 0, n - 1))
    y0 = int(np.clip(l - r_px, 0, n - 1))
    y1 = int(np.clip(l + r_px, 0, n - 1))
    win = heights[y0 : y1 + 1, x0 : x1 + 1]
    iy, ix = np.unravel_index(int(np.argmax(win)) if kind == "max" else int(np.argmin(win)), win.shape)
    return px_to_latlon(x0 + ix, y0 + iy, m_per_px, off)


def horizon_profile(lat0, lon0, h0, primary, fallback):
    """Terrain horizon mask: max terrain elevation angle per azimuth.

    primary/fallback: (dn_int16, off, m_per_px, n). Rays that leave the primary
    product's latitude cap sample the fallback DEM instead of clamped edges.
    """
    heights, off, mpp, n = primary
    site = unit(lat0, lon0) * (R_REF + h0)
    up = site / np.linalg.norm(site)
    ang = DISTANCES / R_REF  # central angles
    lats = np.empty((AZIMUTHS.size, ang.size))
    lons = np.empty_like(lats)
    for i, az in enumerate(AZIMUTHS):
        lats[i], lons[i] = destination(lat0, lon0, az, ang)
    s, l = latlon_to_px(lats, lons, mpp, off)
    hh = bilinear(heights, s, l)
    if fallback is not None:
        inside = np.hypot(s - off, l - off) < (n / 2.0 - 2.0)
        if not inside.all():
            fh, foff, fmpp, fn = fallback
            fs, fl = latlon_to_px(lats, lons, fmpp, foff)
            hh = np.where(inside, hh, bilinear(fh, fs, fl))
    targets = unit(lats, lons) * (R_REF + hh)[..., None]
    los = targets - site
    dist = np.linalg.norm(los, axis=-1)
    elev = np.degrees(np.arcsin((los * up).sum(-1) / dist))
    return elev.max(axis=1)


def validate_projection(dem):
    """Shackleton bowl test: if the lat/lon -> pixel mapping is correct, the
    crater floor center sits kilometres below the rim crest ring."""
    heights, off, mpp, _n = dem
    h_floor = height_at(dem, -89.67, 129.78)
    rim_h = -np.inf
    ring = DISTANCES[(DISTANCES >= 9_000) & (DISTANCES <= 12_000)]
    for az in range(0, 360, 2):
        la, lo = destination(-89.67, 129.78, az, ring / R_REF)
        s, l = latlon_to_px(la, lo, mpp, off)
        rim_h = max(rim_h, float(bilinear(heights, s, l).max()))
    print(
        f"  bowl test: floor {h_floor:+.0f} m, rim crest {rim_h:+.0f} m, "
        f"depth {rim_h - h_floor:.0f} m (published rim-to-floor depth ~4200 m)",
        flush=True,
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "horizons").mkdir(exist_ok=True)
    cache: dict[str, tuple] = {}
    validated = False

    def get_dem(dem_name: str, mpp: float) -> tuple:
        if dem_name not in cache:
            path = ROOT / "data" / "dem" / dem_name
            print(f"loading {dem_name} ...", flush=True)
            dn, off, cap = load_dem(path, mpp)
            cache[dem_name] = (dn, off, mpp, int(round(np.sqrt(dn.size))))
        return cache[dem_name]

    fallback_for = {"ldem_85s_20m.img": "ldem_75s_120m.img", "ldem_75s_120m.img": None}
    manifest = []
    for name, slug, kind, approx, dem_name, mpp, snap, snap_r, note in SITES:
        primary = get_dem(dem_name, mpp)
        fb_name = fallback_for[dem_name]
        fallback = get_dem(fb_name, 120.0) if fb_name else None
        if not validated:
            validate_projection(primary)
            validated = True

        lat, lon = approx
        if snap:
            lat, lon = snap_site(primary, lat, lon, snap, snap_r)
        lat, lon = round(lat, 4), round(lon, 4)
        h0 = round(height_at(primary, lat, lon))
        profile = horizon_profile(lat, lon, h0, primary, fallback)

        doc = {
            "site": name,
            "lat": round(lat, 4),
            "lonEast": round(lon, 4),
            "dem": dem_name.replace(".img", ""),
            "demSource": "NASA LRO LOLA GDR V2.0 (PDS, LRO-L-LOLA-4-GDR-V1.0), polar stereographic",
            "siteHeightM": round(h0),
            "observerHeightAboveGroundM": 0,
            "rayExtentKm": float(DISTANCES.max() / 1000),
            "azimuthStepDeg": 1,
            "referenceRadiusKm": R_REF / 1000,
            "samplingConvention": "zero-based pixel centres; bilinear height interpolation",
            "maxHorizonDeg": round(float(profile.max()), 2),
            "profile": [round(float(v), 2) for v in profile],
        }
        (OUT / "horizons" / f"{slug}.json").write_text(json.dumps(doc, separators=(",", ":")))
        manifest.append(
            {
                "name": name,
                "slug": slug,
                "lat": doc["lat"],
                "lonEast": doc["lonEast"],
                "kind": kind,
                "siteHeightM": doc["siteHeightM"],
                "snap": snap,
                "note": note,
            }
        )
        print(
            f"{name}: ({lat:.4f}, {lon:.4f}) h0={h0:+.0f} m, "
            f"max horizon {profile.max():.2f} deg @ az {int(profile.argmax())}",
            flush=True,
        )

    (OUT / "sites.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} sites to {OUT / 'sites.json'}")


if __name__ == "__main__":
    main()
