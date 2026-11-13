#!/usr/bin/env python3
"""Compute illumination / communication duty-cycle statistics per landing site.

Reads the cached Horizons ephemerides (public/data/ephemeris) and LOLA terrain
horizon masks (public/data/horizons), classifies every cached hour as lit /
shadowed and DTE-link / no-link (terrain-masked), and writes per-site stats to
public/data/dutycycle/<slug>.json.

Classification (terrain-aware, same model as the app):
  LIT(t)   = sun_el(t)   > horizon_el(sun_az(t))
  LINK(t)  = earth_el(t) > horizon_el(earth_az(t))
"""
import math
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def horizon_lookup(horizon):
    profile = horizon["profile"]
    return lambda az: profile[int(math.floor(az + 0.5)) % 360]


def longest_streak(flags: list[bool], value: bool) -> int:
    best = cur = 0
    for f in flags:
        if f == value:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


def compute(slug: str) -> dict:
    sun = json.loads((DATA / "ephemeris" / f"{slug}.sun.json").read_text())["rows"]
    earth = json.loads((DATA / "ephemeris" / f"{slug}.earth.json").read_text())["rows"]
    horizon = json.loads((DATA / "horizons" / f"{slug}.json").read_text())
    hz = horizon_lookup(horizon)

    lit, link = [], []
    for s, e in zip(sun[:-1], earth[:-1]):
        lit.append(s["el"] > hz(s["az"]))
        link.append(e["el"] > hz(e["az"]))

    n = len(lit)
    doc = {
        "site": slug,
        "start": sun[0]["t"],
        "end": sun[-1]["t"],
        "hours": n,
        "litHours": sum(lit),
        "linkHours": sum(link),
        "litPct": round(100.0 * sum(lit) / n, 1),
        "linkPct": round(100.0 * sum(link) / n, 1),
        "longestLitH": longest_streak(lit, True),
        "longestDarkH": longest_streak(lit, False),
        "longestLinkH": longest_streak(link, True),
        "longestNoLinkH": longest_streak(link, False),
        "dem": horizon["dem"],
    }
    (DATA / "dutycycle").mkdir(exist_ok=True)
    (DATA / "dutycycle" / f"{slug}.json").write_text(json.dumps(doc, separators=(",", ":")))
    return doc


def main() -> None:
    sites = json.loads((DATA / "sites.json").read_text())
    print(f"{'site':22} {'lit%':>6} {'link%':>6} {'longestLIT':>10} {'longestDARK':>11} {'longestLINK':>11} {'longestGAP':>10}")
    for s in sites:
        d = compute(s["slug"])
        print(
            f"{d['site']:22} {d['litPct']:>6} {d['linkPct']:>6} "
            f"{d['longestLitH']:>10} {d['longestDarkH']:>11} {d['longestLinkH']:>11} {d['longestNoLinkH']:>10}"
        )
    print(f"\nwindow: {d['start']} to {d['end']}; complete hourly intervals, centre clearance above terrain")


if __name__ == "__main__":
    main()
