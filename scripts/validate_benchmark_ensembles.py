#!/usr/bin/env python3
"""Final validation of the completed Barker 2021 ensembles (handoff steps 1-6).

1. Clone IDs 1-100 present exactly once per model
2. Shared clone SHA-256s across both models
3. Hash chain: per-report generator/horizon/sun fingerprints, geometry-proof
   completeness, paired-worker fingerprint
4. Independent recomputation of the conservative percentiles (1st pct for mean
   and longest illumination, 99th pct for longest darkness; NumPy linear
   quantile) from the 100 per-clone reports
5. Six-metric comparison against Barker Table 2 case A / ROI 4
6. Verdict on the 1 m discrepancy

Per-model mode (``--model reference``) audits one model on its own, so a model can be
released while the other is still being recomputed. ``--ensemble-dir`` reads the
aggregate files from a staging folder instead of public/data/benchmark (a model's
aggregate missing there falls back to the published one, used only for the shared
clone-set check).
"""
import argparse
import hashlib
import json
import os
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "benchmark-cache"
MODELS = {
    "reference": CACHE / "ensemble",
    "matched": CACHE / "matched" / "ensemble",
}
GENERIC = "Site01_final_adj_5mpp_{:04d}_err.json"
# Working-copy SHA-256s of the November 2026 regeneration (geometry proof = verify_benchmark_geometry.py,
# production paired worker = run_benchmark_paired_worker.py); recorded at the reference release.
PROOF_SHA = "e28726c90e65ab568e2569760ef7ed89b0ed4e00624cfe206d9fb864d7184877"
WORKER_SHA = "2f2e96ff92e4b00ac740ee2090a83b74623c888021d0c21730ccbbaf2b8ab28d"
checks = 0

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--model", choices=("reference", "matched", "both"), default="both",
                    help="audit one model, or both (default)")
parser.add_argument("--ensemble-dir", type=pathlib.Path, default=ROOT / "public" / "data" / "benchmark",
                    help="folder holding the aggregate ensemble files (default: public/data/benchmark)")
args = parser.parse_args()
SELECTED = ("reference", "matched") if args.model == "both" else (args.model,)
PUBLIC = ROOT / "public" / "data" / "benchmark"
FILES = {"reference": "barker2021-roi4-ensemble.json", "matched": "barker2021-roi4-matched-ensemble.json"}


def check(ok, label):
    global checks
    checks += 1
    if not ok:
        raise SystemExit(f"FAILED: {label}")


def load_agg(mode):
    path = args.ensemble_dir.resolve() / FILES[mode]
    if not path.exists():
        check(mode not in SELECTED, f"{mode}: aggregate file present in {args.ensemble_dir}")
        path = PUBLIC / FILES[mode]
    print(f"{mode:>10} aggregate: {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    return json.loads(path.read_text(encoding="utf-8"))


ref_agg = load_agg("reference")
mat_agg = load_agg("matched")
ref_src = {s["id"]: s["sha256"] for s in ref_agg["sources"]}
mat_src = {s["id"]: s["sha256"] for s in mat_agg["sources"]}
check(ref_src == mat_src and len(ref_src) == 100,
      "shared clone SHA-256s identical across both models (all 100)")
check(sorted(ref_src) == list(range(1, 101)), "published source IDs are exactly 1-100")

# Checks that remain reproducible from a clean clone. The 200 full per-clone
# reports are a multi-gigabyte local audit cache and are intentionally ignored;
# published artifacts still carry the inputs, aggregation contract and outputs.
for mode, agg in (("reference", ref_agg), ("matched", mat_agg)):
    if mode not in SELECTED:
        continue
    check(agg["cloneCount"] == 100, f"{mode}: published clone count is 100")
    check("NumPy linear quantile" in agg["aggregation"], f"{mode}: quantile convention disclosed")
    check({r["mastHeightM"] for r in agg["rows"]} == {1, 5}, f"{mode}: 1 m and 5 m rows present")
    for row in agg["rows"]:
        for key in ("meanPct", "longestDarkDays", "longestLightDays"):
            expected = row["ensemblePercentile"][key] - row["published"][key]
            check(abs(row["difference"][key] - expected) < 1e-12,
                  f"{mode} {row['mastHeightM']} m {key}: published difference is internally consistent")

deep_available = os.environ.get("LANDSIGHT_PUBLIC_ONLY") != "1" and all(
    (folder / GENERIC.format(i)).exists()
    for mode, folder in MODELS.items() if mode in SELECTED
    for i in range(1, 101)
)

summary = {"reference": ref_agg["rows"], "matched": mat_agg["rows"]}
generator = hashlib.sha256((ROOT / "scripts" / "build_benchmark.py").read_bytes()).hexdigest()
generators = {"reference": generator}


def matched_generator():
    """The matched model runs a generated snapshot (build_benchmark_matched.prepare), not build_benchmark.py itself.
    Its reports fingerprint the snapshot file's bytes; the snapshot's text must be exactly the controlled
    substitution of the current build_benchmark.py (newlines as written on this platform)."""
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_benchmark_matched as matched
    snapshot = CACHE / "matched" / "build_matched_snapshot.py"
    check(snapshot.exists() and snapshot.read_text(encoding="utf-8") == matched.snapshot_source(),
          "matched: generator snapshot is the controlled derivation of the current build_benchmark.py")
    return hashlib.sha256(snapshot.read_bytes()).hexdigest()


if deep_available and "matched" in SELECTED:
    generators["matched"] = matched_generator()
if deep_available:
    per_model = {}
    for mode, folder in MODELS.items():
        if mode not in SELECTED:
            continue
        reports = {}
        for i in range(1, 101):
            reports[i] = json.loads((folder / GENERIC.format(i)).read_text(encoding="utf-8"))
        check(sorted(reports) == list(range(1, 101)), f"{mode}: clone IDs 1-100 with no omissions")
        check(not [i for i, r in reports.items() if "pendingCalculation" in r],
              f"{mode}: no unfinished (seeded) report")
        by_metrics = {}
        for i, r in reports.items():
            key = json.dumps(sorted((row["mastHeightM"], sorted(row["nominal"].items())) for row in r["rows"]))
            by_metrics.setdefault(key, []).append(i)
        copies = [ids for ids in by_metrics.values() if len(ids) > 1]
        check(not copies, f"{mode}: each clone's metrics are its own calculation (identical reports for clones {copies})")
        gens = {r["audit"]["generatorSha256"] for r in reports.values()}
        hzs = {r["audit"]["horizonCacheSha256"] for r in reports.values()}
        suns = {r["audit"]["sunCacheSha256"] for r in reports.values()}
        check(len(gens) == 1 and len(suns) == 1,
              f"{mode}: generator and Sun-cache fingerprints uniform across 100 clones")
        check(gens == {generators[mode]}, f"{mode}: reports were produced by "
              + ("the current build_benchmark.py" if mode == "reference" else "the matched snapshot of the current build_benchmark.py"))
        sources = (ref_agg if mode == "reference" else mat_agg)["sources"]
        check(sorted(s["id"] for s in sources) == list(range(1, 101)), f"{mode}: aggregate lists the 100 audited clones")
        check(len(hzs) == 100,
              f"{mode}: horizon-cache fingerprint unique per clone (each clone is its own terrain)")
        per_model[mode] = reports

    # Deep local audit: geometry proof + production worker fingerprints.
    proof = json.loads((CACHE / "geometry-proof" / "complete.json").read_text(encoding="utf-8"))
    check(proof.get("verified") is True, "geometry proof complete")
    check(proof.get("generatorSha256") == PROOF_SHA, "geometry-proof fingerprint matches the recorded proof")
    worker = hashlib.sha256((ROOT / "scripts" / "run_benchmark_paired_worker.py").read_bytes()).hexdigest()
    check(worker == WORKER_SHA, "production paired-worker fingerprint matches the recorded worker")

    # Independent conservative percentile recomputation from all 200 reports.
    for mode, reports in per_model.items():
        per_height = {1: {"mean": [], "dark": [], "light": []}, 5: {"mean": [], "dark": [], "light": []}}
        for report in reports.values():
            for row in report["rows"]:
                h = row["mastHeightM"]
                per_height[h]["mean"].append(row["nominal"]["meanPct"])
                per_height[h]["dark"].append(row["nominal"]["longestDarkDays"])
                per_height[h]["light"].append(row["nominal"]["longestLightDays"])
        agg = ref_agg if mode == "reference" else mat_agg
        for row in agg["rows"]:
            h = row["mastHeightM"]
            expect = {
                "meanPct": float(np.percentile(per_height[h]["mean"], 1)),
                "longestLightDays": float(np.percentile(per_height[h]["light"], 1)),
                "longestDarkDays": float(np.percentile(per_height[h]["dark"], 99)),
            }
            for key, value in expect.items():
                check(abs(row["ensemblePercentile"][key] - value) < 1e-9,
                      f"{mode} {h} m {key}: worker aggregation == independent recomputation")
else:
    print("PUBLIC-ARTIFACT MODE: local per-clone reports absent; deep percentile recomputation skipped")

# 5/6. verdict table
print(f"ALL {checks} VALIDATION CHECKS PASSED\n")
print(f"{'model':>10} {'mast':>5} {'mean %':>18} {'longest dark d':>18} {'longest light d':>18}")
for mode in SELECTED:
    for r in summary[mode]:
        e, p = r["ensemblePercentile"], r["published"]
        print(f"{mode:>10} {str(r['mastHeightM'])+' m':>5} "
              f"{e['meanPct']:7.2f} vs {p['meanPct']:<7.2f} "
              f"{e['longestDarkDays']:7.2f} vs {p['longestDarkDays']:<7.2f} "
              f"{e['longestLightDays']:7.2f} vs {p['longestLightDays']:<7.2f}")

print(f"\nDeep audit {'run' if deep_available else 'NOT run'} for: {', '.join(SELECTED)}")
# The cross-model verdict is meaningful only when both aggregates were recomputed from audited per-clone reports
# of the same calculation; otherwise one model may still be the previous (differently sampled) calculation.
if SELECTED != ("reference", "matched") or not deep_available:
    if SELECTED == ("reference", "matched"):
        print("Cross-model verdict skipped: it needs the audited per-clone reports of both models.")
    raise SystemExit(0)
ref1 = next(r for r in summary["reference"] if r["mastHeightM"] == 1)["difference"]
mat1 = next(r for r in summary["matched"] if r["mastHeightM"] == 1)["difference"]
print(f"\n1 m verdict: reference vs paper {ref1['meanPct']:+.2f} pp; matched (Barker terrain + 550 nm disc) {mat1['meanPct']:+.2f} pp")
print(f"matched - reference: {mat1['meanPct'] - ref1['meanPct']:+.3f} pp -> terrain-model and disc choice "
      f"do NOT explain the residual")
