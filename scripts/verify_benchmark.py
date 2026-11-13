"""Check benchmark provenance and numerical contracts; not an accuracy tolerance."""
import hashlib,json
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[1]
report=json.loads((root/'public/data/benchmark/barker2021-roi4.json').read_text(encoding='utf-8'))
checks=0
def check(condition,message):
    global checks
    assert condition,message
    checks+=1
check(report['hours']==17544,'Exact two-year hourly interval')
check(report['pixelCount']==532 and report['areaM2']==532*25,'ROI raster area')
check('not replication' in report['comparisonType'],'Different statistics disclosed')
check(len(report['differences'])>=4,'Method differences disclosed')
profiles=np.load(root/'data/benchmark-cache/roi4-horizons.npz')['profiles']
check(profiles.shape==(532,2,720),'Complete per-pixel and per-height masks')
check(np.isfinite(profiles).all(),'Finite horizons')
check((profiles[:,1]<=profiles[:,0]+1e-10).all(),'Higher mast cannot raise terrain horizon')
sun=np.load(root/'data/benchmark-cache/sun-2024-2026.npy')
check(sun.shape==(17544,3) and np.isfinite(sun).all(),'Complete finite Sun vectors')
for source in report['sources']:
    candidates=[root/'data/space-cache'/source['path'],root/'data/benchmark-cache'/source['path'],root/'data/dem'/source['path']]
    path=next(p for p in candidates if p.exists())
    with path.open('rb') as f: value=hashlib.file_digest(f,'sha256').hexdigest()
    check(value==source['sha256'],'Source fingerprint '+source['path'])
for row in report['rows']:
    for key,value in row['nominal'].items():
        check(np.isfinite(value) and value>=0,'Finite nonnegative metric')
        check(abs(row['difference'][key]-(value-row['published'][key]))<1e-10,'Unadjusted comparison difference')
    check(row['nominal']['meanPct']<=100,'Illumination range')
    check(row['nominal']['longestDarkDays']<=731 and row['nominal']['longestLightDays']<=731,'Duration range')
check(report['rows'][1]['nominal']['meanPct']>=report['rows'][0]['nominal']['meanPct'],'Height illumination monotonicity')
print(f'Benchmark checks passed: {checks} (no external-accuracy pass/fail claimed)')

check(report['version'] == 2, 'Audited report schema')
audit = report['audit']
check(audit['rasterCentresVerified'], 'Original pixel centres verified during calculation')
for name, key in [('roi4-horizons.npz', 'horizonCacheSha256'), ('sun-2024-2026.npy', 'sunCacheSha256')]:
    with (root/'data/benchmark-cache'/name).open('rb') as f:
        check(hashlib.file_digest(f, 'sha256').hexdigest() == audit[key], 'Derived cache fingerprint '+name)
with (root/'scripts/build_benchmark.py').open('rb') as f:
    check(hashlib.file_digest(f, 'sha256').hexdigest() == audit['generatorSha256'], 'Generator fingerprint')
for row in report['rows']:
    for key, metric in row['nominal'].items():
        bounds = audit['pixelMetricRanges'][str(row['mastHeightM'])][key]
        check(bounds['min'] <= metric <= bounds['max'], 'Regional mean within pixel range')
print(f'Audited benchmark checks passed: {checks}')

from benchmark_math import visible_fraction
q = np.linspace(-1, 1, 401)
for u in [0, .25, .6, 1]:
    f = visible_fraction(q, u)
    check(np.isfinite(f).all() and (f>=-1e-12).all() and (f<=1+1e-12).all(), 'Disc fraction bounded')
    check((np.diff(f)>=-1e-12).all(), 'Disc fraction monotone')
    check(np.allclose(f + visible_fraction(-q,u), 1), 'Complementary visible disc')
    # Independent numerical strip integration of I(mu)=1-u+u*mu.
    y = (np.arange(20000)+.5)/10000-1
    strip = (1-u)*2*np.sqrt(1-y*y) + u*np.pi/2*(1-y*y)
    for cut in [-.8, -.3, 0, .4, .9]:
        numeric = strip[y>=-cut].sum()/strip.sum()
        check(abs(float(visible_fraction(cut,u))-numeric)<2e-5, 'Analytic disc versus independent quadrature')
for row in report['rows']:
    bounds = audit['discDiagnostic']['meanBoundsPct'][str(row['mastHeightM'])]
    check(bounds['lower'] <= row['nominal']['meanPct'] <= bounds['upper'], 'Nominal within disc bounds')
with (root/'scripts/benchmark_math.py').open('rb') as f:
    check(hashlib.file_digest(f,'sha256').hexdigest()==audit['discDiagnostic']['mathSha256'], 'Disc diagnostic fingerprint')
print(f'Benchmark including independent disc checks passed: {checks}')

# ——— Horizons residuals fixture (F1): gates, negative control, provenance ———
res_path = root/'public/data/benchmark/horizons-residuals.json'
check(res_path.exists(), 'Residuals fixture exists')
if res_path.exists():
    res = json.loads(res_path.read_text(encoding='utf-8'))
    check(len(res['results']) >= 4, 'Residuals cover multiple series')
    for r in res['results']:
        check(r['samples'] >= 40, 'Residual series has enough samples')
        check(r['maxDeg'] <= res['gateMaxDeg'], 'Residual within gate: ' + r['slug'] + '/' + r['target'])
        check(r['rmsDeg'] <= r['maxDeg'], 'RMS below max: ' + r['slug'])
        check(r['worst']['deltaDeg'] == r['maxDeg'], 'Worst residual consistent: ' + r['slug'])
    ctl = res['negativeControl']
    check(ctl['failsGate'] is True, 'Negative control fails the gate')
    check(ctl['medianDeg'] > res['controlGateMinDeg'], 'Control median above threshold')
    check(ctl['minDeg'] > res['gateMaxDeg'], 'No control sample passes the gate')
    check(res['passed'] is True, 'Fixture records an overall pass')
    gen = root/'scripts/build_horizons_residuals.py'
    with open(gen, 'rb') as f:
        check(hashlib.file_digest(f, 'sha256').hexdigest()
              == res['provenance']['generatorSha256'], 'Generator fingerprint matches')
print(f'Residuals fixture checks passed')
