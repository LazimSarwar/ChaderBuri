#!/usr/bin/env python3
"""Model-ablation uncertainty for the duty-cycle screening numbers.

The Evidence/Validation percentages are computed under one model choice:
point-sun centre vs the terrain mask, hourly samples. This script re-runs
the classification under alternative model choices and records the spread:

  V0 baseline   point-sun centre, hourly           (what the app ships)
  V1 disc model solar-disc fraction >= 50% above the mask, hourly
  V2 fine time  point-sun centre, 10-min linear interpolation of az/el

The spread bounds how much of a site's headline number is model choice
rather than terrain. It is NOT a measurement error bar. The terrain axis
is covered separately by the Barker 2021 clone ensemble.
Usage: python scripts/build_uncertainty.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
OUT = DATA / "benchmark" / "model-ablation.json"


def mask_lookup(horizon):
    profile = horizon["profile"]
    return lambda az: profile[int(__import__("math").floor(az + 0.5)) % 360]


def interp_rows(rows, minutes):
    """Linear az/el interpolation onto a finer grid; radiusDeg interpolated too."""
    out = []
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for k in range(minutes):
            f = k / minutes
            daz = ((b["az"] - a["az"] + 180) % 360) - 180  # shortest wrap
            out.append({
                "az": (a["az"] + daz * f) % 360,
                "el": a["el"] + (b["el"] - a["el"]) * f,
                "radiusDeg": a.get("radiusDeg", 0.267) + (b.get("radiusDeg", 0.267) - a.get("radiusDeg", 0.267)) * f,
            })
    out.append({"az": rows[-1]["az"], "el": rows[-1]["el"], "radiusDeg": rows[-1].get("radiusDeg", 0.267)})
    return out


def disc_fraction(el, mask, radius):
    """Fraction of the solar disc above the mask (circular-segment area)."""
    import math
    d = (el - mask) / max(radius, 1e-9)
    d = max(-1.0, min(1.0, d))
    return 0.5 + (d * math.sqrt(max(0.0, 1 - d * d)) + math.asin(d)) / math.pi


def lit_pct(sun, earth, hz, mode):
    n = len(sun)
    lit = 0
    for i in range(n):
        s = sun[i]
        mask = hz(s["az"])
        if mode == "point":
            lit += s["el"] > mask
        else:  # disc majority
            lit += disc_fraction(s["el"], mask, s.get("radiusDeg", 0.267)) >= 0.5
    return 100.0 * lit / n


def link_pct(earth, hz):
    n = len(earth)
    return 100.0 * sum(1 for e in earth if e["el"] > hz(e["az"])) / n


def main():
    sites = json.loads((DATA / "sites.json").read_text(encoding="utf-8"))
    rows_out = []
    for site in sites:
        slug = site["slug"]
        sun = json.loads((DATA / "ephemeris" / f"{slug}.sun.json").read_text(encoding="utf-8"))["rows"]
        earth = json.loads((DATA / "ephemeris" / f"{slug}.earth.json").read_text(encoding="utf-8"))["rows"]
        hz = mask_lookup(json.loads((DATA / "horizons" / f"{slug}.json").read_text(encoding="utf-8")))
        v0 = lit_pct(sun, earth, hz, "point")
        v1 = lit_pct(sun, earth, hz, "disc")
        fine = interp_rows(sun, 6)  # 60 min -> 10 min
        v2 = lit_pct(fine, earth, hz, "point")
        rows_out.append({
            "slug": slug,
            "litPctPoint1h": round(v0, 2),
            "litPctDisc1h": round(v1, 2),
            "litPctPoint10min": round(v2, 2),
            "maxAbsSpreadPct": round(max(abs(v1 - v0), abs(v2 - v0)), 2),
            "linkPct": round(link_pct(earth, hz), 2),
        })
        print(f"{slug:>20}: point1h {v0:6.2f}  disc1h {v1:6.2f}  point10min {v2:6.2f}  spread {rows_out[-1]['maxAbsSpreadPct']:.2f} pp", flush=True)
    doc = {
        "version": 1,
        "createdUTC": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "method": "Duty-cycle classification re-run under alternative model choices: "
                  "V0 shipped (point-sun centre vs terrain mask, hourly), V1 solar-disc "
                  "fraction >= 50% above the mask, V2 point-sun on a 10-min linear "
                  "interpolation. The spread bounds model-choice sensitivity of headline "
                  "percentages; it is not a measurement error bar. The terrain axis is "
                  "covered by the Barker 2021 clone ensemble (see horizons residuals and "
                  "benchmark audit).",
        "rows": rows_out,
        "maxSpreadPct": round(max(r["maxAbsSpreadPct"] for r in rows_out), 2),
    }
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"wrote {OUT.name}: max spread {doc['maxSpreadPct']} pp across {len(rows_out)} sites")


if __name__ == "__main__":
    main()
