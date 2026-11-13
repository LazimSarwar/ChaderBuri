#!/usr/bin/env python3
"""Commit an engine-vs-live-Horizons residual fixture for the Evidence tab.

Re-queries JPL Horizons live for a deterministic sample of the cached hourly
epochs and records the angular separation between the cached az/el (what the
app serves) and the live response. Includes a time-shifted negative control:
the same queries moved +SHIFT hours must FAIL the residual gate, proving the
fixture cannot pass vacuously.

This is a provenance check (cached data matches its declared source), not an
independent astronomical validation. Usage:
    python scripts/build_horizons_residuals.py
"""
import datetime as dt
import hashlib
import json
import math
import pathlib
import statistics
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fetch_ephemeris import parse  # reuse the exact response parser

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "benchmark" / "horizons-residuals.json"

SITES = ["shackleton-rim", "malapert-massif", "faustini-rim"]
TARGETS = {"sun": "10", "earth": "399"}
SAMPLE_STRIDE = 384       # ~53 epochs across the 20,449-hour cache
FIRST_ROW = 1000          # skip the first hours; includes run boundaries later
SHIFT_HOURS = 37          # negative control: move the epoch, expect large deltas
CONTROL_SAMPLES = 12
GATE_MAX_DEG = 0.05       # pass gate: every residual must sit under this
CONTROL_GATE_MIN_DEG = 5.0  # control median must exceed this (and must FAIL the gate)


def arc_deg(az1: float, el1: float, az2: float, el2: float) -> float:
    """Angular separation between two topocentric az/el directions."""
    a1, e1, a2, e2 = map(math.radians, (az1, el1, az2, el2))
    dot = (math.cos(e1) * math.cos(a1) * math.cos(e2) * math.cos(a2)
           + math.cos(e1) * math.sin(a1) * math.cos(e2) * math.sin(a2)
           + math.sin(e1) * math.sin(e2))
    cross = math.sqrt(max(0.0, 1.0 - min(1.0, dot * dot)))
    # atan2, not acos: acos floors near zero and would mask tiny residuals
    return math.degrees(math.atan2(cross, dot))


def fetch_epoch(lat: float, lon: float, height_m: float, target_code: str,
                epoch: str) -> dict:
    """Live Horizons observer query for one site at one UTC epoch."""
    params = {
        "format": "text",
        "COMMAND": f"'{target_code}'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"'{lon:.4f},{lat:.4f},{height_m / 1000:.6f}'",
        "START_TIME": f"'{epoch}'",
        "STOP_TIME": f"'{shift_epoch(epoch, 10 / 60)}'",  # +10 minutes
        "STEP_SIZE": "'1m'",
        "QUANTITIES": "'4,13,20'",
        "EXTRA_PREC": "YES",
    }
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                text = r.read().decode("utf-8", "replace")
            rows = parse(text)
            if rows:
                return rows[0]
            last_err = RuntimeError("no data rows")
        except Exception as e:  # noqa: BLE001
            last_err = e
        print(f"  retry {attempt + 1}: {last_err}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"Horizons epoch fetch failed: {last_err}")


def shift_epoch(epoch: str, hours: float) -> str:
    # cached rows use Horizons' month-name format, e.g. 2026-Oct-12 16:00
    t = dt.datetime.strptime(epoch, "%Y-%b-%d %H:%M") + dt.timedelta(hours=hours)
    return t.strftime("%Y-%b-%d %H:%M")


def main() -> None:
    eph = ROOT / "public" / "data" / "ephemeris"
    sites = {s["slug"]: s for s in json.loads((ROOT / "public" / "data" / "sites.json").read_text(encoding="utf-8"))}
    queries = 0
    results = []
    for slug in SITES:
        site = sites[slug]
        lat, lon, height = site["lat"], site["lonEast"] % 360.0, site["siteHeightM"]
        for tname, tcode in TARGETS.items():
            cached = json.loads((eph / f"{slug}.{tname}.json").read_text(encoding="utf-8"))["rows"]
            picks = list(range(FIRST_ROW, len(cached), SAMPLE_STRIDE))[:53]
            if picks[-1] != len(cached) - 1:
                picks.append(len(cached) - 1)
            deltas = []
            worst = None
            for i in picks:
                row = cached[i]
                live = fetch_epoch(lat, lon, height, tcode, row["t"])
                queries += 1
                d = arc_deg(row["az"], row["el"], live["az"], live["el"])
                deltas.append(d)
                if worst is None or d > worst["deltaDeg"]:
                    worst = {"t": row["t"], "cachedAz": row["az"], "cachedEl": row["el"],
                             "liveAz": live["az"], "liveEl": live["el"], "deltaDeg": round(d, 8)}
                time.sleep(0.7)  # be polite to the shared API
            results.append({
                "slug": slug, "target": tname, "samples": len(deltas),
                "maxDeg": round(max(deltas), 8),
                "rmsDeg": round(math.sqrt(statistics.fmean(d * d for d in deltas)), 8),
                "medianDeg": round(statistics.median(deltas), 8),
                "worst": worst,
            })
            print(f"{slug} {tname}: max {max(deltas):.2e} deg over {len(deltas)} samples", flush=True)

    # Negative control: same site/body, epochs shifted; the fixture must fail there.
    cached = json.loads((eph / f"{SITES[0]}.sun.json").read_text(encoding="utf-8"))["rows"]
    site = sites[SITES[0]]
    control_deltas = []
    for i in range(FIRST_ROW, FIRST_ROW + CONTROL_SAMPLES * SAMPLE_STRIDE, SAMPLE_STRIDE):
        row = cached[i]
        live = fetch_epoch(site["lat"], site["lonEast"] % 360.0, site["siteHeightM"], "10",
                           shift_epoch(row["t"], SHIFT_HOURS))
        queries += 1
        control_deltas.append(arc_deg(row["az"], row["el"], live["az"], live["el"]))
        time.sleep(0.7)
    control = {
        "slug": SITES[0], "target": "sun", "shiftHours": SHIFT_HOURS,
        "samples": len(control_deltas),
        "medianDeg": round(statistics.median(control_deltas), 6),
        "minDeg": round(min(control_deltas), 6),
    }
    passed = all(r["maxDeg"] <= GATE_MAX_DEG for r in results)
    control_fails = control["medianDeg"] > CONTROL_GATE_MIN_DEG and control["minDeg"] > GATE_MAX_DEG
    doc = {
        "version": 1,
        "createdUTC": dt.datetime.now(dt.timezone.utc).isoformat(),
        "method": "Cached hourly az/el re-queried live from JPL Horizons (DE441, topocentric, "
                  "site observer heights); separation via atan2 cross/dot. Provenance check, "
                  "not an independent astronomical validation.",
        "gateMaxDeg": GATE_MAX_DEG,
        "controlGateMinDeg": CONTROL_GATE_MIN_DEG,
        "results": results,
        "negativeControl": {**control, "failsGate": control_fails},
        "passed": passed and control_fails,
        "queries": queries,
        "provenance": {
            "generator": "scripts/build_horizons_residuals.py",
            "generatorSha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            "source": "NASA/JPL Horizons live API",
            "sites": SITES,
        },
    }
    if not control_fails:
        raise SystemExit("Negative control did not fail — fixture would be vacuous; refusing to write.")
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"wrote {OUT.name}: passed={doc['passed']} queries={queries} "
          f"max={max(r['maxDeg'] for r in results):.2e}deg control median {control['medianDeg']:.2f}deg")


if __name__ == "__main__":
    main()
