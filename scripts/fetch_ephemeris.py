#!/usr/bin/env python3
"""Fetch Sun/Earth observer ephemerides for lunar south-pole sites from JPL Horizons.

Reads public/data/sites.json and writes public/data/ephemeris/<slug>.<target>.json

Data source: NASA/JPL Solar System Dynamics Horizons API — https://ssd.jpl.nasa.gov/api/horizons.api
Ephemeris: DE441. Center: Moon (301), body-fixed geodetic site coordinates.
Azimuth: degrees clockwise from local north. Elevation: degrees above the local
geodetic horizon (airless; no refraction on the Moon).
"""
import json
import gzip
import pathlib
import sys
import time
import datetime as dt
import hashlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"

# Site coordinates come from compute_horizons.py (public/data/sites.json), which
# anchors them to LOLA DEM ground truth — single source of truth for this repo.
SITES = json.loads((OUT / "sites.json").read_text(encoding="utf-8"))

TARGETS = {"sun": "10", "earth": "399"}
START = "2026-09-01"
STOP = "2028-12-31"  # 28 months, hourly — "now" through two full lighting seasons
STEP = "1h"


def fetch(site_lat: float, site_lon: float, target_code: str, height_m: float = 0) -> tuple[str, str]:
    params = {
        "format": "text",
        "COMMAND": f"'{target_code}'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"'{site_lon:.4f},{site_lat:.4f},{height_m / 1000:.6f}'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4,13,20'",
        "EXTRA_PREC": "YES",
    }
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                text = r.read().decode("utf-8", "replace")
            if "$$SOE" in text and "$$EOE" in text:
                return text, url
            last_err = RuntimeError("response missing data section")
        except Exception as e:  # noqa: BLE001 - report and retry
            last_err = e
        print(f"  retry {attempt + 1}: {last_err}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"Horizons fetch failed: {last_err}")


def parse(text: str) -> list[dict]:
    rows = []
    inside = False
    for line in text.splitlines():
        if line.startswith("$$SOE"):
            inside = True
            continue
        if line.startswith("$$EOE"):
            break
        if not inside:
            continue
        t = line.split()
        if len(t) < 3:
            continue
        nums: list[float] = []
        for tok in t[2:]:
            try:
                nums.append(float(tok))
            except ValueError:
                continue  # skip solar-presence / visibility flag tokens (*, i, t, ...)
            if len(nums) == 5:
                break
        if len(nums) == 5:
            rows.append({"t": f"{t[0]} {t[1]}", "az": round(nums[0], 6), "el": round(nums[1], 6),
                         "radiusDeg": round(nums[2] / 7200, 8), "rangeKm": round(nums[3] * 149597870.7, 3)})
    return rows


def main() -> None:
    eph_dir = OUT / "ephemeris"
    eph_dir.mkdir(parents=True, exist_ok=True)
    # Stage the entire refresh. A failed upstream request must not leave half the
    # sites using a different observer convention.
    staged = []
    for site in SITES:
        name, slug = site["name"], site["slug"]
        lat, lon = site["lat"], site["lonEast"] % 360.0
        for tname, tcode in TARGETS.items():
            print(f"{name} <- {tname} ...", flush=True)
            raw, source_url = fetch(lat, lon, tcode, site["siteHeightM"])
            rows = parse(raw)
            expected = int((dt.datetime.fromisoformat(STOP) - dt.datetime.fromisoformat(START)).total_seconds() / 3600) + 1
            if len(rows) != expected:
                raise ValueError(f"Expected {expected} hourly boundary samples; got {len(rows)}")
            if 'MEAN_ME' not in raw or '1737.4, 1737.4, 1737.4' not in raw:
                raise ValueError('Unexpected lunar frame or reference radii; inspect upstream header')
            doc = {
                "site": name,
                "target": tname,
                "start": START,
                "stop": STOP,
                "stepHours": 1,
                "provenance": {
                    "source": "NASA/JPL Horizons", "retrievedUTC": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "url": source_url, "rawSha256": hashlib.sha256(raw.encode()).hexdigest(),
                    "observer": {"lat": lat, "lonEast": lon, "heightKm": site["siteHeightM"] / 1000},
                    "frame": "DE421 lunar mean Earth", "referenceRadiusKm": 1737.4,
                    "ephemeris": "DE441", "quantities": "4,13,20", "timeScale": "UTC",
                    "observerHeightAboveGroundM": 0,
                },
                "rows": rows,
            }
            staged.append((eph_dir / f"{slug}.{tname}.json", json.dumps(doc, separators=(",", ":"))))
            print(f"  {len(rows)} rows", flush=True)
            time.sleep(1.5)  # be polite to the API
    for path, content in staged:
        temporary = path.with_suffix('.tmp')
        temporary.write_text(content, encoding='utf8')
        path.with_suffix('.json.gz').write_bytes(gzip.compress(content.encode('utf8'), compresslevel=9, mtime=0))
        temporary.replace(path)
    print(f"done: {len(SITES)} sites (complete refresh)")


if __name__ == "__main__":
    main()
