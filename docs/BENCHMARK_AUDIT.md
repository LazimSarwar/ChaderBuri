# Benchmark investigation — 13 October 2026

## Result

The six nominal metrics reproduce the previous calculation exactly. No justified
numerical correction to those values was identified by this audit. The 1 m
comparison remains unresolved; this is not an external-validation pass.

## Reference checks

Barker et al. 2021, Table 2, case A, ROI 4 was checked against rendered PDF page 8.
The six reference values, region area 13,300 m², 532 raster centres, 2024–2026
interval, and 1 m/5 m observer heights match. Both cases use 5 m terrain pixels.

Section 5 and pages 14–15 explain that nominal terrain tends to predict more
favourable illumination than the uncertainty clones: a single positive elevation
perturbation can raise a horizon, while lowering it requires multiple favourable
perturbations. This supports an explanation for the direction of bias, not a
quantitative attribution of Landsight's discrepancy.

At 1 m, the average difference is +8.008 percentage points, longest illumination
+57.892 days and longest darkness −3.264 days. At 5 m, differences are +0.442
percentage points, +0.883 days and −0.113 days respectively.

## Reliability corrections

- Assert every ROI coordinate is an original GeoTIFF pixel centre.
- Replace hard-coded raster dimensions in interpolation with actual dimensions.
- Reject missing near-field and far-field elevations, malformed/nonfinite vector
  and horizon caches, and incorrect mast-horizon ordering.
- Fingerprint the generator and both derived caches in the exported report.
- Refuse reuse when an audited derived cache changes unexpectedly.
- Record per-pixel metric ranges and verify regional means fall within them.
- Present the 1 m discrepancy prominently and distinguish mast height from pixel
  resolution in the evidence panel.

## Remaining method differences

The report is a nominal regional mean; Table 2 A uses conservative percentiles
across 100 spatially correlated clones. Landsight uses uniform disk weighting,
20/120 m far-field products, and geometric DE440 vectors. The paper uses 550 nm
limb darkening and 80/240 m far-field products. Exact attribution requires matched
runs, including the original clone ensemble. Arbitrary independent pixel noise
would not reproduce that ensemble and is not substituted here.

Sources:
- https://ntrs.nasa.gov/citations/20205009660
- https://pgda.gsfc.nasa.gov/products/78

No calibration factor or acceptance tolerance was introduced to force agreement.


## Disk-weighting diagnostic — 14 October 2026

Analytically integrated I(mu)=1-u+u*mu over the exposed disk, for all u in [0,1].
The endpoints bound every linear coefficient; pointwise endpoint minima/maxima
also yield conservative bounds on the regional average. At 1 m those bounds
are 77.4885–77.7535%; at 5 m, 88.4667–88.6827%. Every pixel/hour retained identical
light/dark classification, so longest illumination/shadow streaks are unchanged.
Independent strip quadrature checks the analytic formula. The diagnostic does
not match the paper's wavelength-dependent model, but rules out this family of
weighting changes as an explanation of the large discrepancy. The nominal model
is unchanged. Original 100-clone and far-field replication remain incomplete.


## Original terrain ensemble — started 14 October 2026

`npm run data:benchmark-ensemble` downloads the original Site01 clones 0001–0100
from the authors' PGDA archive and evaluates the same 532 ROI 4 raster centres,
two observer heights, and 17,544 hourly samples. Checkpoints are private under
`data/benchmark-cache/ensemble`; clone horizons have separate filenames and do
not replace the nominal horizon cache or the application result.

Important source interpretation: the `*_err.tif` files contain full perturbed
terrain elevations. Clone 0001 has median elevation 1,200.252 m, compared with
1,200.249 m for the nominal raster. Its difference from nominal has standard
deviation 0.4435 m. The clone is used directly, never added to nominal terrain.
Registration and finite elevations are checked before it is used.

The aggregation averages pixel metrics within each clone, then takes the 1st
percentile of illumination and longest illumination, and the 99th percentile
of longest darkness across the 100 clone means. Linear quantile interpolation
is recorded explicitly; the paper does not identify a quantile implementation.
No partial ensemble is published as a 100-clone comparison. The runner rejects
incomplete/mixed-source sets and stale generator fingerprints. Each clone and
its derived caches have SHA-256 fingerprints.

This run isolates the effect of the original terrain ensemble in Landsight's
existing calculation. It is **not yet a fully matched paper replication**:
20/120 m far-field terrain, uniform solar-disc weighting, and geometric DE440
vectors remain. Original 80/240 m product matching and the paper's precise
550 nm weighting implementation still require verification. The discrepancy
remains unresolved until computed results are available; no values in the app
are calibrated or changed to force agreement.

Resume after interruption with the same command, or select a range using
`python scripts/build_benchmark_ensemble.py --first 1 --last 100`.
The calculation is computationally substantial. Source downloads use temporary
files; results are kept per clone. Verification:
`npm run verify:benchmark-ensemble` checks conservative percentile direction,
quantile interpolation, complete-set requirements, mixed methods/data,
reference consistency, and checkpoint rejection.


## Wavelength and legacy terrain matching — 14 October 2026

A separate run (`npm run data:benchmark-matched`) now uses the legacy LOLA PDS
V2.0 LDEM_80S_80M and LDEM_75S_240M products. Their labels specify 80/240 m
pixels, little-endian signed 16-bit samples, 0.5 m height scaling, 1,737,400 m
reference sphere, south-polar stereographic coordinates, and DE421 mean-Earth
frame. Downloads match the label dimensions (7600² and 3812² samples).
The nested sampler uses the original 5 m clone to 5 km, 80 m terrain through
100 km, and 240 m terrain beyond 100 km. It does not keep using the 80 m raster
merely because a ray remains inside its geographic coverage. The exact terrain
archive version and radial sampling used by the authors remain unverified.

Solar brightness uses Pierce & Slaughter (1977) Table IV, equation 11,
I(mu)=sum(A_k*mu^k), with the published 541.760 and 552.200 nm coefficient rows
linearly interpolated to 550 nm. Both rows were checked visually against printed
page 39. The integration is over the projected solar disk above a horizontal
horizon cut; analytic regularized beta integrals account for each polynomial
term. Six independent tests cover tiny-crescent precision and numerical strip quadrature at 41 cuts,
physical brightness, monotonic visibility, symmetry, endpoints, and geometric
light/dark classification. Barker specifies 550 nm but does not identify the
coefficient set; wavelength matching is not proof of exact implementation parity.

Holding the nominal 20/120 m horizons fixed, this weighting changes 1 m average
illumination from 77.618155% to 77.621146% (+0.002991 percentage points), and 5 m
from 88.562195% to 88.575173% (+0.012978 points). For original clone 0001, the
changes are +0.002392 and +0.013085 points. All sampled light/dark classifications
are unchanged. This particular documented solar model does not explain the
large 1 m gap. The diagnostic is saved at
`data/benchmark-cache/disc-550-diagnostic.json`, with input fingerprints.

The matched experiment freezes a separate generated calculation source under
`data/benchmark-cache/matched`, with separate horizon names and checkpoint
reports; it cannot replace the original comparison. Only a complete 100-clone
set can produce `public/data/benchmark/barker2021-roi4-matched-ensemble.json`.
Neither ensemble has yet completed. The full discrepancy is still unresolved.

Primary sources:
- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/
- https://articles.adsabs.harvard.edu/pdf/1977SoPh...51...25P


## Interruption recovery and numerical edge fix — 14 October 2026

Both calculations now run as hidden background Python processes with separate
stdout/stderr logs under their ensemble checkpoint directories. Process IDs are
recorded in `data/benchmark-cache/active-runs.json`; this records a launched
process and is not by itself proof that it is still alive.

Horizon profiles are atomically checkpointed every 16 completed pixels. A restart
checks the input-source and generator signature, finite values, array dimensions,
and observer-height ordering before restoring the completed prefix. Partial
arrays never enter a complete ensemble result. Report writes are also atomic.
Four checkpoint tests verify bit-for-bit recovery, stale-source rejection,
corruption rejection, and invalid horizons/shape rejection. Completed clone 0001
was reused and its six metrics remain unchanged.

A real numerical edge case was fixed in the 550 nm implementation: subtracting a
CDF very close to one could round a positive, extremely thin visible crescent to
zero. Using the complementary beta CDF retains that positive brightness. A test
includes the floating-point value immediately above -1 clearance ratio. This
prevents a rounding-induced false darkness sample; it does not explain the large
published discrepancy. The baseline operational mission model is unchanged.

A terrain-only diagnostic at the published ROI4 centroid (not all ROI pixels)
finds legacy-minus-current far-field horizons from -0.04548 to +0.01084 degrees
at 1 m. Its mean is -0.00205 degrees. This is not a regional illumination or
ensemble result. The saved diagnostic fingerprints all four DEM inputs.

The full ensemble comparison remains in progress. Exact author solar coefficient
choice, terrain release, and radial sampling still require confirmation even
after the runs finish.


## Performance without changing the numerical method — 14 October 2026

A two-pixel cProfile probe found terrain interpolation to dominate the repeated
horizon work; whole-DEM reads and source hashing add startup cost. The workstation
has six physical CPU cores and 8 GB RAM, with approximately 1 GB free before
optimization. The two original sequential processes each mostly occupied one core.

The accelerated worker uses read-only int16 memory mapping for the PDS images.
The projection metadata and height scaling are unchanged. Verification compares
every stored sample in all four DEMs and 50,000 bilinear samples per DEM: 540
checks pass. Two real clone-0002 ROI pixels produce bitwise identical 720-direction
horizons at both observer heights and exactly equal per-pixel metrics. A short
warm-system probe took 9.559 s with the original reader and 8.752 s with mapping;
this is not a full-clone throughput measurement. Source hashing stays enabled.

Each model is now split into nonoverlapping clone ranges 1–50 and 51–100, with
one process per range (four total). This increases CPU concurrency while allowing
shared mapped file pages instead of duplicating full DEM arrays in each process.
The solar model, terrain resolutions, ray distances, azimuths, hourly times,
float64 arithmetic and percentile aggregation are unchanged. Existing partial
horizons remain valid and were resumed; no completed scientific outputs were reset.

Worker invocation example:
`python scripts/run_benchmark_worker.py --mode reference --first 1 --last 50`
Use `--mode matched` for the legacy-terrain/550 nm calculation. Clone ranges for
a given model must not overlap. Active worker IDs, ranges and log paths are in
`data/benchmark-cache/active-runs.json`; per-range progress files and stdout logs
identify the current clone. Count completed `*_err.json` files for total progress,
rather than inferring completion from a range's last clone number.

Downloads have process-specific temporary names. An atomic create-if-absent
hard link prevents two models from overwriting the same downloaded clone; a
second completed download must have identical SHA-256. JSON publications also
use process-specific temporary names. Full-ensemble validation still requires
all 100 matching reports and source/cache fingerprints before publication.


After launch, all four workers were confirmed computing without stderr errors;
free physical RAM remained approximately 1 GB. This doubles clone concurrency
per model, but no full-run speedup factor is claimed yet. Per-report execution
timings describe the current invocation and may include restored checkpoints;
they should not be interpreted as a fresh full-clone duration when resumed.


## Geometry reuse validation and deployment — 15 October 2026

An isolated `python scripts/verify_benchmark_geometry.py` validation paired original clones
0001 and 0002. For each 60-azimuth block it computes clone-independent destination
coordinates, unit vectors, far-field samples, and near-field interpolation indices
and weights once. Each clone still supplies its own elevation raster and observer
height. The interpolation expression, Cartesian ray arithmetic and maximum
reduction remain unchanged. Only one block of geometry is retained at a time.

The completed proof checked every ROI pixel against the original stored horizon arrays for
both models, then compared all six regional metrics per clone exactly. All 532 pixels,
both observer heights, all 720 azimuths, both clones and both terrain/solar models
were bitwise equal. The six regional metrics for each clone were exactly equal. The first
four pixels also compare fresh uncached and reused kernels directly and record
paired timings. The four-pixel reference probe averaged 12.85 s without reuse and
8.30 s with reuse; the matched probe averaged 14.11 s and 9.54 s. These are directly
paired kernel measurements, not a full-worker speedup claim. Full proof elapsed times
were 4,802.07 s and 4,145.23 s while four production workers were also active, so they
are not compared with an uncontended single-worker baseline.

The proof certificate is private under `data/benchmark-cache/geometry-proof/complete.json`.
It records the proof-source SHA-256 and input/cache fingerprints. Both model-specific
worker self-tests require that certificate, re-hash its sources, validate clone 0001/0002
reports and derived caches, and reject any changed kernel. Only after those checks passed
were the four range workers changed to `scripts/run_benchmark_paired_worker.py`.

The production worker restores each clone's existing signed partial horizon prefix.
When paired clones have different checkpoint positions, it computes only the missing
prefix for the less advanced clone; shared geometry begins when both need the same pixel.
It then shares one 60-azimuth block at a time and discards it before the next block.
Completed reports retain the original scientific-generator fingerprint and also record
the paired backend, proof, I/O backend, pair IDs, geometry wall time, and report-finalization
time. The solar model, terrain products, ray sampling, observer heights, float64 operation
order, hourly interval, and percentile aggregation are unchanged. Existing completed
reports and saved partial prefixes were retained during the switch.

At deployment, both ensembles had 13 complete clone reports. This is a progress marker,
not a partial scientific conclusion. No ensemble percentile or resolution of the 1 m
discrepancy will be reported until both validated 100-clone sets complete.

The first fully fresh production pairs provide a comparable throughput measurement.
For the reference model, pairs 0010–0011 and 0059–0060 took 3,322.80 s and
3,197.22 s including both report finalizations, averaging 3,260.01 s per two clones.
Earlier fresh single-clone runs 0003 and 0051 totaled 4,140.64 s under the same
four-range-worker arrangement. That is a measured 21.27% reduction in two-clone
wall time (1.270× throughput) for this workload. For the matched model, the fresh
pairs took 3,153.79 s and 3,193.30 s, averaging 3,173.54 s, versus 4,089.30 s for
earlier fresh clones 0002 and 0051: a 22.39% reduction (1.289× throughput).
These are observed workstation timings, not a numerical-method or cross-machine
performance guarantee. The compared reports retain identical scientific settings;
the first migrated pairs 0008–0009 and 0057–0058 are excluded because their clone
checkpoints began at unequal positions.

## Ensemble validation — 19 October 2026

Both 100-clone ensembles completed (reference terrain model and the matched
legacy 80/240 m + 550 nm solar-disc model), 200 paired-clone reports total.
Validation: clone IDs 1-100 with no omissions, identical clone SHA-256s across
models, uniform generator and Sun-cache fingerprints, per-clone horizon-cache
fingerprints, geometry-proof and paired-worker hashes matching the recorded
values, and worker aggregation equal to an independent NumPy-linear-quantile
recomputation (`scripts/validate_benchmark_ensembles.py`; deep mode with the
archival cache). A clean clone runs the published-artifact subset instead.

| model | mast | mean illum | longest dark | longest light |
|---|---|---|---|---|
| reference | 1 m | 71.64 vs 69.61 (+2.03 pp) | 14.05 vs 13.27 (+0.78 d) | 141.98 vs 136.49 (+5.49 d) |
| reference | 5 m | 88.22 vs 88.12 (+0.10 pp) | 3.98 vs 4.00 (-0.02 d) | 231.64 vs 231.20 (+0.44 d) |
| matched | 1 m | 71.66 vs 69.61 (+2.05 pp) | same | same |
| matched | 5 m | 88.26 vs 88.12 (+0.14 pp) | same | same |

Conservative statistics: 1st percentile for mean and longest illumination,
99th percentile for longest darkness, compared with the paper's Table 2 case A
ROI 4 values.

### Verdict: REDUCED and characterized

- The earlier 8.01 pp / 57.89 d gap at 1 m was largely a statistic mismatch
  (nominal terrain vs the paper's uncertainty-ensemble percentile). Computed
  as a same-statistic 100-clone ensemble, the gap at 1 m is +2.03 pp / +5.49 d.
- Switching to the paper's legacy terrain mix and 550 nm disc weighting moves
  the result by +0.014 pp: terrain-model and solar-disc choices are ruled out
  as the cause of the remaining difference.
- 5 m agreement is near-exact (<= 0.14 pp, <= 0.44 d) on every metric.

Caveats retained: Barker's exact clone realizations are not published, so the
remaining ~2 pp at 1 m cannot be attributed to realization differences;
terrain archive release/radial sampling remain uncertain; this is a
published-method comparison, not flight certification.

## Near-field sampling and cache integrity — 9 November 2026

A read-only investigation (no published file changed) found three defects. The
published tables above predate these fixes and are kept until the regeneration
below is run.

**1. Under-sampled near field.** Horizons were searched every 5 m along each
azimuth. Within a few hundred metres that steps over sub-pixel peaks of the
bilinear 5 m surface, so a 1 m observer saw too much Sun. Recomputing all 100
clones with 0.25 m steps within 500 m, as `max(stored horizon, refined near
field)`, after first reproducing the stored per-clone results to 1.5e-12. That
reproduction shows the recalculation is internally consistent with the published
run; it says nothing about external accuracy, which the NASA residual still
limits. An independent review re-aggregated the saved per-clone results and
reproduced these percentiles exactly. The experiment's scripts and per-clone
results are kept in `data/benchmark-cache/nearfield-experiment-2026-11/`.

| reference model | NASA | published | 0.25 m near field | gap before → after |
|---|---|---|---|---|
| 1 m mean illumination | 69.61% | 71.64% | 71.07% | +2.03 → +1.46 pp |
| 1 m longest light | 136.49 d | 141.98 d | 138.47 d | +5.49 → +1.98 d |
| 1 m longest dark | 13.27 d | 14.05 d | 14.33 d | +0.78 → +1.06 d |
| 5 m mean illumination | 88.12% | 88.22% | 88.19% | +0.10 → +0.08 pp |
| 5 m longest light / dark | 231.20 / 4.00 d | 231.64 / 3.98 d | 231.59 / 3.99 d | essentially unchanged |

The matched model shifts by the same amounts (1 m mean 71.66 → 71.09%). Every
clone moves the same way (1 m mean −0.39 to −0.58 pp). Further refinement gives
diminishing changes: 0.5 → 0.25 m changes the ensemble by 0.03 pp; 0.25 →
0.125 m changes clones 12 and 84 by ≤0.015 pp and ≤0.08 d; reaching 2 km instead
of 500 m changes them by ≤0.004 pp. This convergence is only with respect to how
finely the bilinearly interpolated 5 m surface is sampled along each ray; it does
not establish the accuracy of the underlying 5 m terrain or of every shadow
boundary. At 5 m the results remain close to NASA's (≤0.08 pp, ≤0.39 d) for this
single region, though small differences remain.

Sampling explains about 0.57 pp of the 2.03 pp mean-illumination gap at 1 m and
most of the longest-light gap (5.49 → 1.98 d). Refining the skyline widens the
darkness gap (0.78 → 1.06 d). About 1.46 pp at 1 m remains unexplained. One
untested candidate is the interpolation of the 5 m clone rasters itself
(bilinear here; the authors' method may differ), which can shave small peaks.

**2. Stale caches could be reused.** `build_benchmark.py` reused horizon and Sun
caches whenever the previous report's sources matched, ignoring its generator
fingerprint, and `run_benchmark_paired_worker.py` reused any complete horizon
cache without any check. A rerun after a method change would have kept the old
horizons under the new generator's fingerprint.

**3. An interrupted report could pass validation.** The paired worker seeded each
report by copying clone 1's finished report and stamping the new clone's
fingerprints before calculating. The matched run was stopped at pixel 417/532 of
clone 14's calculation on 15 October; on restart the seed validated and clone 14
was skipped, so the published matched clone 14 report contains clone 1's
metrics, execution details and timestamp. Substituting clone 14's recalculated
values changes the published percentiles only by floating-point rounding
(≤1e-12; clone 14 is far from both tails), but the matched ensemble is not fully
valid. This is the most serious integrity finding: it shows that valid
fingerprints did not guarantee a completed calculation.

### Fixes

- `build_benchmark.DISTANCES` is the one radial sampling definition (0.25 m to
  500 m, 5 m to 5 km, then 100/200 m to 220 km; a superset of the old samples).
  The paired geometry kernel and the far-field diagnostic use it, and the
  matched snapshot inherits it. `npm run verify:benchmark-sampling` checks the
  single definition and that halving the near-field step moves no sampled
  horizon by more than 0.02° (it fails for 5 m and 0.5 m steps).
- Complete horizon caches now carry the signature of their sources and generator
  (`benchmark_checkpoint.save_complete` / `load_complete`); unsigned or
  differently signed caches are recomputed. `build_benchmark.cache_reusable`
  requires the previous report's generator to match.
- Worker seeds are minimal, carry no metrics and are marked
  `pendingCalculation`; `validate_report` rejects them. Sun vectors are copied
  only from a validated clone-1 report. The geometry proof records the
  fingerprint of the calculation it matched (`calculationSha256`) and the worker
  refuses a proof made for another generator. Publication and
  `validate_benchmark_ensembles.py` reject two clones with identical metrics.

Until regeneration, `verify:benchmark` (generator fingerprint) and
`verify:benchmark-ensembles` (matched clones 1 and 14 identical; old worker
fingerprint) fail by design, and the paired worker refuses to start.

### Regeneration order (started 9 November; see below)

0. Archive `data/benchmark-cache/ensemble`, `matched/ensemble`,
   `geometry-proof` and `matched/build_matched_snapshot.py`: they are the audit
   trail of the published run and are overwritten below.
1. `npm run data:benchmark` (nominal reference report).
2. Clones 1–2 of both models with the unpaired path
   (`build_benchmark_ensemble.py --first 1 --last 2`,
   `build_benchmark_matched.py --first 1 --last 2`); the matched one also
   rewrites the matched snapshot. Each ends by refusing the still-stale reports
   of clones 3–100, which is expected at this stage.
3. `python scripts/verify_benchmark_geometry.py` (fresh proof for both models).
4. Paired workers for clones 3–100 in both modes; they publish both ensembles.
5. Update `PROOF_SHA` / `WORKER_SHA` in `validate_benchmark_ensembles.py`, run all
   benchmark suites and `npm run data:index` (the benchmark JSON files are part
   of the prediction-index fingerprint), then update this audit, `SCIENCE.md`
   and `src/BenchmarkPanel.tsx`.

Because the new samples contain the old ones, the regenerated results should
equal the refined 100-clone figures above apart from floating-point rounding.

The finer sampling makes each horizon ~1.75× more samples. To offset part of
that, the paired kernel (`verify_benchmark_geometry.geometry`) now looks up
far-field terrain only where the clone raster does not supply the height
(beyond 5 km); `block()` never read those values. The lookups are element-wise,
and old and new kernels gave bitwise-identical horizons on 28,800 values (both
models, five ROI pixels, all 12 azimuth blocks, two clones, both masts) with
half the geometry time. That is a sample, not a proof: equivalence for the whole
run holds only if the stage-3 proof passes, which checks every horizon of clones
1–2 bit for bit against `build_benchmark.py`; the workers refuse to start
otherwise.

Regeneration started 9 November 2026 19:22 with the resumable driver
`data/benchmark-cache/regen-2026-11/run_regeneration.py` (progress in its
`status.json`; rerun it with `--wait` to resume after a reboot). The published
run is archived in `data/benchmark-cache/archive-2026-10-published/`.

**Reference first, staged publication (9 November 20:21).** To meet the project
deadline the coordinator was replaced by v2 (v1 kept beside it) without
interrupting any computation: only the coordinator process was stopped, after a
test showed that stopping a coordinator started this way leaves its jobs running;
v2 waits for every running benchmark computation (found from Windows' process
list, not bookkeeping) before it schedules anything, so no clone has two writers.
v2 then runs all four workers on the reference clones 3–100 before any matched
clone. Every job writes its published outputs (the nominal report and both
ensembles) to `regen-2026-11/staging/benchmark/` instead of `public/`: the
coordinator sets the output-path globals before calling each unmodified script,
and a guard refuses any publication outside staging. No numerical script,
kernel, input or fingerprinted file changed.

Until release, the app keeps serving the October files with their matching
prediction index; the Sources card labels them "Previous calculation · October
2026" with the two known limitations. The reference release then publishes the
staged nominal and reference ensemble, the rebuilt index, this audit,
`SCIENCE.md` and the card (reference ensemble as the primary comparison) together,
after the benchmark suites and a deep per-clone audit of the reference model
(`validate_benchmark_ensembles.py` needs a per-model mode for that). Until the
matched rerun is released, the card identifies the matched ensemble as the
October calculation by date and method. The matched release follows when its
rerun validates; it does not block the project deadline.

## Reference release — 10 November 2026

All 100 reference clones validated at 15:44 (`regen-2026-11/status.json`:
reference 100/100, no failed jobs; the coordinator's checkpoint, ensemble, IO,
sampling and solar-disc suites passed). Before publication,
`python scripts/validate_benchmark_ensembles.py --model reference --ensemble-dir
data/benchmark-cache/regen-2026-11/staging/benchmark` passed 28 checks on the
staged files: clone IDs 1–100 exactly once, no unfinished (`pendingCalculation`)
report, no two clones with identical metrics, one generator fingerprint equal to
the current `build_benchmark.py`, one Sun-cache fingerprint, 100 distinct
horizon caches, the geometry proof complete with the recorded fingerprint, the
production worker fingerprint, and the 1st/99th percentiles recomputed
independently from the 100 reports equal to the staged aggregate. The validator
gained that per-model mode (`--model`, `--ensemble-dir`) so one model can be
released while the other is still being calculated.

| reference model | NASA | October 2026 (5 m near field) | 10 November 2026 (0.25 m) | gap |
|---|---|---|---|---|
| 1 m mean illumination | 69.61% | 71.64% | 71.07% | +1.46 pp |
| 1 m longest light | 136.49 d | 141.98 d | 138.47 d | +1.98 d |
| 1 m longest dark | 13.27 d | 14.05 d | 14.33 d | +1.06 d |
| 5 m mean illumination | 88.12% | 88.22% | 88.20% | +0.08 pp |
| 5 m longest light | 231.20 d | 231.64 d | 231.59 d | +0.39 d |
| 5 m longest dark | 4.00 d | 3.98 d | 3.99 d | −0.01 d |

The regenerated ensemble reproduces the near-field experiment above to the
reported precision. The nominal report (`barker2021-roi4.json`) was regenerated
with the same sampling (1 m nominal mean 77.62 → 77.46%; nominal values are a
different statistic and are shown only for context).

Published together: the staged nominal report and reference ensemble in
`public/data/benchmark/`, the rebuilt prediction index (`npm run data:index`),
this audit, `docs/SCIENCE.md` and the Sources card, which now leads with the
reference ensemble and labels the matched ensemble "Previous calculation ·
October 2026 · 5 m near-field sampling". The matched rerun was still running
(clones in progress on four workers) and was not touched; its release follows
when it validates. Until then `verify:benchmark-ensembles` (both models) can only
check the published aggregates: it reports that the deep audit was not run and
skips the cross-model verdict, because the matched aggregate is still the
October calculation. `--model reference` runs the full deep audit and passes. Working-copy SHA-256s at release: `build_benchmark.py` b23cc232…0f78,
`verify_benchmark_geometry.py` e28726c9…4877 (geometry proof),
`run_benchmark_paired_worker.py` 2f2e96ff…b28d (production worker).

## Matched release — 11 November 2026

All 100 matched clones validated at 08:08 (`regen-2026-11/status.json`: stage
`done`, reference and matched 100/100, no failed jobs; the coordinator's suites
passed). Before publication, `python scripts/validate_benchmark_ensembles.py
--model both --ensemble-dir data/benchmark-cache/regen-2026-11/staging/benchmark`
passed all 50 checks with the deep audit of both models, including independent
percentile recomputation from the 200 per-clone reports.

The first run failed one check: the matched reports' generator fingerprint
(`25ca2f22…`) differed from `build_benchmark.py` (`b23cc232…`). That is by
design: the matched model runs the generated snapshot
`benchmark-cache/matched/build_matched_snapshot.py`
(`build_benchmark_matched.prepare()`), not `build_benchmark.py` itself. The
validator now expects the snapshot's fingerprint for the matched model, and
first checks that the snapshot's text is exactly `snapshot_source()`, the
controlled substitution of the current `build_benchmark.py`. The reports
fingerprint the file's bytes as written on Windows (CRLF). No report, input or
numerical script changed.

| matched model | NASA | October 2026 (5 m near field) | 11 November 2026 (0.25 m) | gap | vs reference |
|---|---|---|---|---|---|
| 1 m mean illumination | 69.61% | 71.66% | 71.08% | +1.47 pp | +0.015 pp |
| 1 m longest light | 136.49 d | 141.98 d | 138.47 d | +1.98 d | 0.00 d |
| 1 m longest dark | 13.27 d | 14.05 d | 14.33 d | +1.06 d | 0.00 d |
| 5 m mean illumination | 88.12% | 88.26% | 88.23% | +0.11 pp | +0.035 pp |
| 5 m longest light | 231.20 d | 231.64 d | 231.59 d | +0.39 d | 0.00 d |
| 5 m longest dark | 4.00 d | 3.98 d | 3.99 d | −0.01 d | 0.00 d |

As in October, the legacy terrain grids and the 550 nm limb-darkened disc move
the 1 m result by only about 0.015 pp, so they do not explain the 1 m residual.

Published together: the staged matched ensemble in `public/data/benchmark/`
(the staged nominal report and reference ensemble were already identical to the
published files), the rebuilt prediction index (dataset `d31daf419689`, model id
unchanged), this audit, `docs/SCIENCE.md` and the Sources card. The card no
longer labels the matched ensemble as a previous calculation, and the
"Matched ensemble" download is dated November 2026.

### Next

No further scientific-model changes until the regeneration and its validation
are complete. Then investigate how the terrain interpolation differs from the
authors' method, since the remaining 1 m gap still needs an explanation. The
observer height of the production site horizons is a separate decision about
what the app models; changing it answers a different physical question and is
not a way to close this residual.
