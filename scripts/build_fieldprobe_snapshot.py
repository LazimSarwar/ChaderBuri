#!/usr/bin/env python3
"""Record a FieldProbe snapshot fixture so demos work without internet.

With ?snapshot=1 the app resolves FieldProbe observer queries from
public/data/benchmark/fieldprobe-snapshot.json instead of the live Horizons
API (a "Cached snapshot" badge marks it in the UI). The fixture is recorded
from the SAME live API the app uses — one script, same parser, no synthetic
data. Regenerate: python scripts/build_fieldprobe_snapshot.py
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_horizons_residuals import fetch_epoch, arc_deg  # noqa: F401 (arc kept for parity checks)
from fetch_ephemeris import parse  # noqa: F401

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "benchmark" / "fieldprobe-snapshot.json"
TARGETS = {"sun": "10", "earth": "399"}

# Demo-path probes: named scenarios spanning the cached window and the three
# showcase sites. (body, slug, epoch-offset-hours from cache start)
PROBES = [
    ("sun", "shackleton-rim", 1000), ("earth", "shackleton-rim", 1000),
    ("sun", "malapert-massif", 4200), ("earth", "malapert-massif", 4200),
    ("sun", "de-gerlache-rim", 9200), ("earth", "de-gerlache-rim", 9200),
    ("sun", "faustini-rim", 14400), ("earth", "faustini-rim", 14400),
    ("sun", "malapert-massif", 17600), ("earth", "malapert-massif", 17600),
]


def main():
    sites = {s["slug"]: s for s in json.loads((ROOT / "public" / "data" / "sites.json").read_text(encoding="utf-8"))}
    entries = []
    for body, slug, row_index in PROBES:
        site = sites[slug]
        rows = json.loads((ROOT / "public" / "data" / "ephemeris" / f"{slug}.{body}.json").read_text(encoding="utf-8"))["rows"]
        row = rows[row_index]
        live = fetch_epoch(site["lat"], site["lonEast"] % 360.0, site["siteHeightM"], TARGETS[body], row["t"])
        entries.append({
            "body": body,
            "slug": slug,
            "lat": round(site["lat"], 4),
            "lonEast": round(site["lonEast"] % 360.0, 4),
            "epoch": row["t"],
            "epochMs": __import__("datetime").datetime.strptime(row["t"], "%Y-%b-%d %H:%M").replace(
                tzinfo=__import__("datetime").timezone.utc).timestamp() * 1000,
            "row": live,
            "cachedRow": {"az": row["az"], "el": row["el"]},
        })
        print(f"{slug} {body} @ {row['t']}: az {live['az']:.4f} el {live['el']:.4f}", flush=True)
        time.sleep(0.7)
    doc = {
        "version": 1,
        "createdUTC": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "note": "Recorded live from JPL Horizons (same observer convention as the app). "
                "Served by FieldProbe only in ?snapshot=1 demo mode, with a visible badge.",
        "entries": entries,
    }
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"wrote {OUT.name}: {len(entries)} probes")


if __name__ == "__main__":
    main()
