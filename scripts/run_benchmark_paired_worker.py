"""Bounded-memory paired-clone Barker ROI4 worker.

The expensive ray geometry is shared by two terrain clones for one 60-azimuth
block at a time.  The numerical kernel is imported from the completed full-ROI
parity proof, so production cannot silently drift from the verified code.
"""
import argparse
import io
import json
import os
import pathlib
import shutil
import sys
import tarfile
import time

import numpy as np
import rasterio
import requests
import shapefile
from shapely import intersects_xy
from shapely.geometry import shape

import build_benchmark as reference
import build_benchmark_ensemble as ensemble
from benchmark_checkpoint import cache_signature, load_complete, load_partial, save_complete, save_partial
from benchmark_io import load_dem_mapped
import verify_benchmark_geometry as proof


ROOT = reference.hz.ROOT
CACHE = reference.CACHE
CLONES = CACHE / "clones"
PROOF_DIR = CACHE / "geometry-proof"
PAIR_BACKEND = pathlib.Path(__file__)


def model(mode):
    if mode == "matched":
        import build_benchmark_matched
        calculation = build_benchmark_matched.prepare()
        checkpoint_dir = CACHE / "matched" / "ensemble"
        prefix = "matched-"
        terrain = [(CACHE / "LDEM_75S_240M.IMG", 240), (CACHE / "LDEM_80S_80M.IMG", 80)]
        source_tail = [
            CACHE / "LDEM_80S_80M.IMG", CACHE / "LDEM_75S_240M.IMG",
            CACHE / "LDEM_80S_80M.LBL", CACHE / "LDEM_75S_240M.LBL",
            pathlib.Path(__file__).with_name("benchmark_solar_disc.py"), CACHE / "pierce1977.pdf",
        ]
    else:
        calculation = reference
        checkpoint_dir = CACHE / "ensemble"
        prefix = ""
        terrain = [(ROOT / "data/dem/ldem_75s_120m.img", 120), (ROOT / "data/dem/ldem_85s_20m.img", 20)]
        source_tail = [ROOT / "data/dem/ldem_85s_20m.img", ROOT / "data/dem/ldem_75s_120m.img"]
    if not np.array_equal(calculation.DISTANCES, proof.DIST):
        raise ValueError("Paired kernel and calculation use different radial sampling")
    calculation.hz.load_dem = load_dem_mapped
    calculation.OUT = checkpoint_dir
    return calculation, checkpoint_dir, prefix, terrain, source_tail


def validate_proof(mode, calculation):
    complete_path = PROOF_DIR / "complete.json"
    complete = json.loads(complete_path.read_text(encoding="utf-8"))
    if complete.get("verified") is not True:
        raise ValueError("Geometry reuse proof is not complete")
    if reference.digest(pathlib.Path(proof.__file__)) != complete.get("generatorSha256"):
        raise ValueError("Verified geometry kernel changed after the proof")
    results = [r for r in complete.get("results", []) if r.get("mode") == mode]
    if len(results) != 1:
        raise ValueError("Missing model-specific geometry proof")
    result = results[0]
    if result.get("calculationSha256") != reference.digest(pathlib.Path(calculation.__file__)):
        raise ValueError("Geometry proof was made for a different calculation; rerun it for this generator")
    if (result.get("pixelCount"), result.get("cloneIds"), result.get("horizonsBitwiseEqual"),
            result.get("allSixRegionalMetricsExactlyEqual")) != (532, [1, 2], True, True):
        raise ValueError("Geometry proof does not cover the full paired calculation")
    search = [ROOT / "data/dem", CACHE / "clones", CACHE]
    for item in result.get("sources", []):
        matches = [folder / item["path"] for folder in search if (folder / item["path"]).exists()]
        if len(matches) != 1 or reference.digest(matches[0]) != item["sha256"]:
            raise ValueError("Geometry proof source changed: " + item["path"])
    return complete, result


def roi():
    with tarfile.open(CACHE / "Site01_ROIs.tgz") as archive:
        files = {m.name.rsplit(".", 1)[-1]: archive.extractfile(m).read()
                 for m in archive.getmembers() if m.isfile()}
        reader = shapefile.Reader(shp=io.BytesIO(files["shp"]),
                                  shx=io.BytesIO(files["shx"]), dbf=io.BytesIO(files["dbf"]))
        polygon = shape(reader.shape(3).__geo_interface__)
    minx, miny, maxx, maxy = polygon.bounds
    x, y = np.meshgrid(np.arange(minx, maxx + 1, 5), np.arange(miny, maxy + 1, 5))
    mask = intersects_xy(polygon, x, y)
    points = np.c_[x[mask], y[mask]]
    if len(points) != 532:
        raise ValueError("Unexpected ROI pixel count")
    lat = -90 + np.degrees(2 * np.arctan2(np.hypot(points[:, 0], points[:, 1]), 2 * reference.hz.R_REF))
    lon = np.degrees(np.arctan2(points[:, 0], points[:, 1]))
    return points, lat, lon


def source_paths(clone_path, source_tail):
    kernels = [ROOT / "data/space-cache" / name for name in
               ["naif0012.tls", "pck00011.tpc", "moon_pa_de421_1900-2050.bpc", "moon_080317.tf"]]
    return kernels + [CACHE / "de440s.bsp", CACHE / "Site01_final_adj_5mpp_surf.tif",
                      CACHE / "Site01_ROIs.tgz", CACHE / "barker2021.pdf"] + source_tail + [clone_path]


def sources_for(clone_path, source_tail):
    return [{"path": path.name, "sha256": reference.digest(path)}
            for path in source_paths(clone_path, source_tail)]


def signature(sources, generator_sha):
    return cache_signature(sources, generator_sha)


def download(index):
    CLONES.mkdir(exist_ok=True)
    filename = f"Site01_final_adj_5mpp_{index:04d}_err.tif"
    path = CLONES / filename
    if path.exists():
        return path
    temporary = path.with_name(path.name + f".{os.getpid()}.download")
    try:
        with requests.get(ensemble.BASE + filename, stream=True, timeout=(20, 90)) as response:
            response.raise_for_status()
            with temporary.open("wb") as target:
                for chunk in response.iter_content(1024 * 1024):
                    target.write(chunk)
        with rasterio.open(temporary) as dataset, rasterio.open(CACHE / "Site01_final_adj_5mpp_surf.tif") as nominal:
            heights = dataset.read(1)
            if dataset.shape != (3200, 3200) or dataset.transform != nominal.transform:
                raise ValueError("Clone registration mismatch")
            if not np.isfinite(heights).all() or float(np.std(heights - nominal.read(1))) > 100:
                raise ValueError("Invalid clone elevations")
        try:
            os.link(temporary, path)
        except FileExistsError:
            if reference.digest(temporary) != reference.digest(path):
                raise ValueError("Concurrent clone downloads differ")
    finally:
        temporary.unlink(missing_ok=True)
    return path


def valid_report(path, index, calculation, clone_path):
    if not path.exists():
        return False
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        ensemble.validate_report(report, index, reference.digest(pathlib.Path(calculation.__file__)),
                                 reference.digest(clone_path))
        return True
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, OSError):
        return False


def load_profiles(cache_path, partial_path, expected_signature):
    """Restore horizons only when they were signed by these exact sources and this generator."""
    profiles = np.empty((532, 2, 720))
    complete = load_complete(cache_path, 532, expected_signature)
    if complete is not None:
        return 532, complete
    restored = load_partial(partial_path, 532, expected_signature)
    if restored:
        completed, prefix = restored
        profiles[:completed] = prefix
        return completed, profiles
    return 0, profiles


def copy_sun(prefix, clone_path, checkpoint_dir, generator_sha):
    """Every clone shares clone 1's Sun vectors; copy only those its validated report records."""
    first = CLONES / "Site01_final_adj_5mpp_0001_err.tif"
    first_report = json.loads((checkpoint_dir / f"{first.stem}.json").read_text(encoding="utf-8"))
    ensemble.validate_report(first_report, 1, generator_sha, reference.digest(first))
    expected = first_report["audit"]["sunCacheSha256"]
    source = CACHE / f"{prefix}{first.stem}-sun.npy"
    if not source.exists() or reference.digest(source) != expected:
        raise ValueError("Validated Sun cache is missing or changed: " + str(source))
    target = CACHE / f"{prefix}{clone_path.stem}-sun.npy"
    if not target.exists() or reference.digest(target) != expected:
        temporary = target.with_name(target.name + f".{os.getpid()}.tmp")
        shutil.copyfile(source, temporary)
        temporary.replace(target)
    sun = np.load(target, mmap_mode="r")
    if sun.shape != (17544, 3) or not np.isfinite(sun).all():
        raise ValueError("Invalid Sun cache: " + str(target))
    return target


def seed_report(report_path, sources, clone_path, cache_path, sun_path, calculation):
    """Hand the paired horizons to calculation.run(), which reuses caches named by this report.

    The seed holds no metrics and is marked pending, so an interrupted calculation leaves a
    report that validate_report refuses; the clone is then recomputed, never skipped."""
    seed = {
        "version": 2, "pendingCalculation": True, "sources": sources, "cloneErrorSource": str(clone_path),
        "audit": {
            "horizonCacheSha256": reference.digest(cache_path),
            "sunCacheSha256": reference.digest(sun_path),
            "generatorSha256": reference.digest(pathlib.Path(calculation.__file__)),
        },
    }
    ensemble.atomic_json(report_path, seed)


def compute_pair(mode, ids, calculation, checkpoint_dir, prefix, terrain, source_tail):
    started = time.perf_counter()
    paths = [download(index) for index in ids]
    heights = []
    transforms = []
    for path in paths:
        with rasterio.open(path) as dataset:
            heights.append(dataset.read(1))
            transforms.append(dataset.transform)
    if transforms[0] != transforms[1] or heights[0].shape != heights[1].shape:
        raise ValueError("Paired clones are not registered")
    transform = transforms[0]
    generator_sha = reference.digest(pathlib.Path(calculation.__file__))
    source_lists = [sources_for(path, source_tail) for path in paths]
    cache_paths = [CACHE / f"{prefix}{path.stem}-horizons.npz" for path in paths]
    partial_paths = [cache.with_suffix(".partial.npz") for cache in cache_paths]
    signatures = [signature(sources, generator_sha) for sources in source_lists]
    loaded = [load_profiles(cache_paths[i], partial_paths[i], signatures[i]) for i in range(2)]
    completed = [item[0] for item in loaded]
    profiles = [item[1] for item in loaded]
    points, lat, lon = roi()
    dems = [load_dem_mapped(path, scale) for path, scale in terrain]
    for index in range(min(completed), 532):
        needed = [i for i in range(2) if index >= completed[i]]
        if not needed:
            continue
        la, lo = lat[index], lon[index]
        up = reference.hz.unit(la, lo)
        grounds = []
        for height in heights:
            col = int(round((points[index, 0] - transform.c) / 5 - .5))
            row = int(round((transform.f - points[index, 1]) / 5 - .5))
            grounds.append(float(height[row, col]))
        values = {i: np.empty((2, 720)) for i in needed}
        for first in range(0, 720, 60):
            shared = proof.geometry(la, lo, first, transform, heights[0].shape, dems, mode)
            for i in needed:
                values[i][:, first:first + 60] = proof.block(shared, heights[i], grounds[i], up)
        for i in needed:
            profiles[i][index] = values[i]
            completed[i] = index + 1
        if (index + 1) % 16 == 0 or index == 531:
            for i in needed:
                save_partial(partial_paths[i], profiles[i], completed[i], signatures[i])
            print(f"{mode} paired clones {ids[0]},{ids[1]} pixel {index + 1}/532", flush=True)
    for i in range(2):
        if completed[i] != 532:
            raise ValueError("Incomplete paired horizon profile")
        save_complete(cache_paths[i], profiles[i], signatures[i])
    geometry_seconds = time.perf_counter() - started
    proof_sha = reference.digest(pathlib.Path(proof.__file__))
    backend_sha = reference.digest(PAIR_BACKEND)
    for i, (index, clone_path) in enumerate(zip(ids, paths)):
        report_path = checkpoint_dir / f"{clone_path.stem}.json"
        sun_path = copy_sun(prefix, clone_path, checkpoint_dir, generator_sha)
        seed_report(report_path, source_lists[i], clone_path, cache_paths[i], sun_path, calculation)
        finalize_started = time.perf_counter()
        calculation.run(clone_path)
        finalize_seconds = time.perf_counter() - finalize_started
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["execution"] = {
            "storage": "Read-only int16 memory mapping; bitwise verified against original reader",
            "ioBackendSha256": reference.digest(PAIR_BACKEND.with_name("benchmark_io.py")),
            "geometryReuse": "Two clones share one bounded 60-azimuth geometry block",
            "geometryProofSha256": proof_sha,
            "pairedBackendSha256": backend_sha,
            "pairCloneIds": ids,
            "pairedGeometrySeconds": geometry_seconds,
            "reportFinalizationSeconds": finalize_seconds,
            "elapsedSeconds": geometry_seconds / 2 + finalize_seconds,
        }
        ensemble.atomic_json(report_path, report)
        ensemble.validate_report(report, index, generator_sha, reference.digest(clone_path))
        if reference.digest(cache_paths[i]) != report["audit"]["horizonCacheSha256"]:
            raise ValueError("Final report/cache fingerprint mismatch")
    for partial in partial_paths:
        partial.unlink(missing_ok=True)
    return geometry_seconds


def self_test(mode, calculation, checkpoint_dir, prefix, source_tail):
    complete, result = validate_proof(mode, calculation)
    generator_sha = reference.digest(pathlib.Path(calculation.__file__))
    for index in (1, 2):
        clone = CLONES / f"Site01_final_adj_5mpp_{index:04d}_err.tif"
        report_path = checkpoint_dir / f"{clone.stem}.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        expected_sources = sources_for(clone, source_tail)
        if report.get("sources") != expected_sources:
            raise ValueError("Paired worker source construction differs from the validated report")
        ensemble.validate_report(report, index, generator_sha, reference.digest(clone))
        cache = CACHE / f"{prefix}{clone.stem}-horizons.npz"
        sun = CACHE / f"{prefix}{clone.stem}-sun.npy"
        if reference.digest(cache) != report["audit"]["horizonCacheSha256"]:
            raise ValueError("Existing horizon cache fingerprint mismatch")
        if reference.digest(sun) != report["audit"]["sunCacheSha256"]:
            raise ValueError("Existing Sun cache fingerprint mismatch")
    print(json.dumps({
        "verified": True, "mode": mode, "pixelCount": result["pixelCount"],
        "cloneIds": result["cloneIds"], "horizonsBitwiseEqual": result["horizonsBitwiseEqual"],
        "allSixRegionalMetricsExactlyEqual": result["allSixRegionalMetricsExactlyEqual"],
        "proofSha256": complete["generatorSha256"], "pairedBackendSha256": reference.digest(PAIR_BACKEND),
    }, indent=2), flush=True)


def publish_if_complete(calculation, checkpoint_dir, prefix):
    reports = []
    generator_sha = reference.digest(pathlib.Path(calculation.__file__))
    for index in range(1, 101):
        clone = CLONES / f"Site01_final_adj_5mpp_{index:04d}_err.tif"
        report_path = checkpoint_dir / f"{clone.stem}.json"
        if not clone.exists() or not report_path.exists():
            return
        report = ensemble.validate_report(json.loads(report_path.read_text(encoding="utf-8")), index,
                                          generator_sha, reference.digest(clone))
        for suffix, key in (("-horizons.npz", "horizonCacheSha256"), ("-sun.npy", "sunCacheSha256")):
            if reference.digest(CACHE / f"{prefix}{clone.stem}{suffix}") != report["audit"][key]:
                raise ValueError("Derived cache fingerprint mismatch")
        reports.append(report)
    rows = ensemble.aggregate_reports(reports)
    output = {
        "cloneCount": 100,
        "aggregation": "Table 2 A: average pixel metrics within each clone, then percentile across clones; NumPy linear quantile",
        "rows": rows, "limits": ensemble.LIMITS,
        "sources": [{"id": i, "url": ensemble.BASE + f"Site01_final_adj_5mpp_{i:04d}_err.tif",
                     "sha256": reference.digest(CLONES / f"Site01_final_adj_5mpp_{i:04d}_err.tif")}
                    for i in range(1, 101)],
    }
    ensemble.atomic_json(ensemble.FINAL_OUTPUT, output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["reference", "matched"], required=True)
    parser.add_argument("--first", type=int)
    parser.add_argument("--last", type=int)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    calculation, checkpoint_dir, prefix, terrain, source_tail = model(args.mode)
    complete, result = validate_proof(args.mode, calculation)
    if args.self_test:
        self_test(args.mode, calculation, checkpoint_dir, prefix, source_tail)
        return
    if args.first is None or args.last is None or not 1 <= args.first <= args.last <= 100:
        raise ValueError("A valid clone range is required")
    print(f"{args.mode}: paired clones in {args.first}..{args.last}; proof {complete['generatorSha256'][:12]}", flush=True)
    pending = []
    for index in range(args.first, args.last + 1):
        clone = CLONES / f"Site01_final_adj_5mpp_{index:04d}_err.tif"
        report = checkpoint_dir / f"{clone.stem}.json"
        if not clone.exists() or not valid_report(report, index, calculation, clone):
            pending.append(index)
    while pending:
        first = pending.pop(0)
        second = pending.pop(0) if pending else None
        if second is None:
            # Pair the final odd clone with a completed neighbor; only the pending member is recomputed.
            second = first - 1 if first > args.first else first + 1
            if not args.first <= second <= args.last:
                raise ValueError("A paired worker range must contain at least two clone IDs")
        elapsed = compute_pair(args.mode, [first, second], calculation, checkpoint_dir, prefix, terrain, source_tail)
        print(f"{args.mode} pair {first},{second} completed in {elapsed:.2f} s geometry wall time", flush=True)
        progress = {"lastCompleted": max(first, second), "requested": [args.first, args.last],
                    "source": ensemble.BASE, "completedAtUnix": time.time(),
                    "execution": "bounded paired-clone geometry reuse"}
        ensemble.atomic_json(checkpoint_dir / f"progress-{args.first}-{args.last}.json", progress)
        if args.first == 1:
            ensemble.atomic_json(checkpoint_dir / "progress.json", progress)
    publish_if_complete(calculation, checkpoint_dir, prefix)


if __name__ == "__main__":
    main()
