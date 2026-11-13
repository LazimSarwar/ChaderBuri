#!/usr/bin/env python3
"""Precompute DSN complex->Moon topocentric elevation for the cached window.

One live Horizons observer query per complex (CENTER='coord@399' geodetic,
DE441, ITRF93 station coordinates) - SPICE-grade station geometry without
shipping SPICE to the browser. Output: public/data/dsn/ with a little-endian
Float32 elevation array per station (one sample per cached hour) plus a
provenance manifest, and a validation record comparing against the app's
analytic Almanac-formula fallback (expected agreement within ~0.5 deg).

Usage: python scripts/build_dsn_geometry.py
"""
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import struct
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fetch_ephemeris import parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
OUT = DATA / "dsn"
START = "2026-09-01"
STOP = "2028-12-31"

# Complexes: geodetic coordinates and site altitudes (DSN 810-005 app. B station data).
STATIONS = [
    {"name": "Goldstone", "lat": 35.4267, "lonEast": 243.1105, "altKm": 0.915},
    {"name": "Madrid", "lat": 40.4272, "lonEast": 356.9114, "altKm": 0.730},
    {"name": "Canberra", "lat": -35.4022, "lonEast": 148.9819, "altKm": 0.420},
]


def fetch_station_elevation(station) -> tuple[str, str]:
    params = {
        "format": "text",
        "COMMAND": "'301'",  # Moon
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@399'",  # Earth body-fixed geodetic
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"'{station['lonEast']:.4f},{station['lat']:.4f},{station['altKm']:.4f}'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": "'1h'",
        "QUANTITIES": "'4,13,20'",  # parser expects the five-column form
    }
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                text = r.read().decode("utf-8", "replace")
            if "$$SOE" in text and "$$EOE" in text:
                return text, url
            last = RuntimeError("response missing data section")
        except Exception as e:  # noqa: BLE001
            last = e
        print(f"  retry {attempt + 1}: {last}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"Horizons fetch failed for {station['name']}: {last}")


# --- analytic fallback (port of src/lib/dsn.ts) for the validation record ---
RAD = math.pi / 180


def julian_day(ms: float) -> float:
    return ms / 86_400_000 + 2_440_587.5


def moon_ra_dec(d: dt.datetime):
    T = (julian_day(d.timestamp() * 1000) - 2_451_545.0) / 36_525
    L = 218.316 + 481_267.8813 * T
    D = 297.8502 + 445_267.1115 * T
    M = 357.5291 + 35_999.0503 * T
    Mp = 134.9634 + 477_198.8676 * T
    F = 93.2721 + 483_202.0175 * T
    lam = (L + 6.289 * math.sin(Mp * RAD) + 1.274 * math.sin((2 * D - Mp) * RAD)
           + 0.658 * math.sin(2 * D * RAD) + 0.214 * math.sin(2 * Mp * RAD)
           - 0.186 * math.sin(M * RAD) - 0.114 * math.sin(2 * F * RAD))
    beta = (5.128 * math.sin(F * RAD) + 0.281 * math.sin((Mp + F) * RAD)
            - 0.28 * math.sin((2 * D + F) * RAD) - 0.17 * math.sin(2 * F * RAD))
    eps = 23.4393
    sinB, cosB = math.sin(beta * RAD), math.cos(beta * RAD)
    ra = math.atan2(math.sin(lam * RAD) * math.cos(eps * RAD) - math.tan(beta * RAD) * math.sin(eps * RAD),
                    math.cos(lam * RAD)) / RAD
    dec = math.asin(sinB * math.cos(eps * RAD) + cosB * math.sin(eps * RAD) * math.sin(lam * RAD)) / RAD
    return ((ra % 360) + 360) % 360, dec


def gmst_deg(d: dt.datetime) -> float:
    g = 280.46061837 + 360.98564736629 * (julian_day(d.timestamp() * 1000) - 2_451_545.0)
    return ((g % 360) + 360) % 360


def analytic_elevation(station, d: dt.datetime) -> float:
    ra, dec = moon_ra_dec(d)
    H = (gmst_deg(d) + station["lonEast"] - ra) * RAD
    geo = math.asin(math.sin(station["lat"] * RAD) * math.sin(dec * RAD)
                    + math.cos(station["lat"] * RAD) * math.cos(dec * RAD) * math.cos(H)) / RAD
    return geo - 0.95 * math.cos(geo * RAD)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hour0 = dt.datetime.fromisoformat(START).replace(tzinfo=dt.timezone.utc)
    stop0 = dt.datetime.fromisoformat(STOP).replace(tzinfo=dt.timezone.utc)
    n_hours = int((stop0 - hour0).total_seconds() // 3600) + 1
    blobs = {}
    validation = {}
    source_urls = {}
    for station in STATIONS:
        print(f"{station['name']} <- Horizons ...", flush=True)
        raw, url = fetch_station_elevation(station)
        source_urls[station["name"]] = url
        rows = parse(raw)
        if len(rows) != n_hours:
            raise SystemExit(f"{station['name']}: expected {n_hours} rows, got {len(rows)}")
        elev = [r["el"] for r in rows]
        blobs[station["name"]] = struct.pack(f"<{len(elev)}f", *elev)
        # validation vs analytic at a deterministic sample (every 97 h)
        deltas = []
        for i in range(0, n_hours, 97):
            d = hour0 + dt.timedelta(hours=i)
            deltas.append(elev[i] - analytic_elevation(station, d))
        validation[station["name"]] = {
            "samples": len(deltas),
            "maxAbsDeltaDeg": round(max(abs(x) for x in deltas), 4),
            "meanAbsDeltaDeg": round(sum(abs(x) for x in deltas) / len(deltas), 4),
        }
        print(f"  {len(elev)} rows; analytic max |delta| {validation[station['name']]['maxAbsDeltaDeg']:.3f} deg", flush=True)
        time.sleep(1.5)

    combined = b"".join(blobs[s["name"]] for s in STATIONS)
    payload = gzip.compress(combined, compresslevel=9, mtime=0)
    (OUT / "elevations.f32.gz").write_bytes(payload)
    manifest = {
        "version": 1,
        "createdUTC": dt.datetime.now(dt.timezone.utc).isoformat(),
        "start": START,
        "stop": STOP,
        "stepHours": 1,
        "layout": "Float32 little-endian elevations (deg), station-major, hour-minor",
        "stations": STATIONS,
        "counts": {"hours": n_hours, "stations": len(STATIONS)},
        "source": "NASA/JPL Horizons observer queries, CENTER=coord@399 geodetic station coordinates (ITRF93), DE441",
        "provenance": {
            "generator": "scripts/build_dsn_geometry.py",
            "generatorSha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            "payloadSha256": hashlib.sha256(payload).hexdigest(),
            "perStation": source_urls,
        },
        "validation": validation,
        "note": "Analytic fallback (src/lib/dsn.ts Astronomical Almanac formula, ~0.3 deg class) "
                "agrees with the SPICE-grade station geometry within the recorded deltas; the "
                "precomputed series is authoritative inside the window.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {OUT / 'elevations.f32.gz'} ({len(payload) / 1024:.0f} KiB) + manifest.json")


if __name__ == "__main__":
    main()
