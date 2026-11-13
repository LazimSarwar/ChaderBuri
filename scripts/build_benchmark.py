"""Reproducible nominal regional comparison with Barker 2021 Table 2, A, ROI 4.

Matches all 532 published ROI pixel centres, 2024--2026 dates and mast heights.
Reports (rather than conceals) differences from the 100-clone percentiles.
"""
import hashlib
import io
import json
import pathlib
import tarfile
from datetime import datetime, timedelta, timezone
import numpy as np
import rasterio
import shapefile
from shapely.geometry import shape
from shapely import intersects_xy
import spiceypy as spice
import compute_horizons as hz
from benchmark_math import visible_fraction
from benchmark_checkpoint import cache_signature, load_complete, load_partial, save_complete, save_partial

CACHE = hz.ROOT / 'data' / 'benchmark-cache'
OUT = hz.OUT / 'benchmark'

# Radial terrain samples along every azimuth (m); the single definition used by the benchmark,
# its matched snapshot and the paired geometry kernel. Within 500 m the 5 m surface is sampled
# every 0.25 m so sub-pixel peaks of its bilinear interpolation are not stepped over (5 m steps
# made the 1 m results ~0.5 pp too bright). Halving 0.25 m again changed the 1 m regional results
# of clones 12 and 84 by <=0.015 pp and <=0.08 d; scripts/verify_benchmark_sampling.py guards it.
NEAR_FIELD_STEP_M = .25
NEAR_FIELD_REACH_M = 500
LOCAL_TERRAIN_REACH_M = 5000
DISTANCES = np.r_[np.arange(1, round(NEAR_FIELD_REACH_M/NEAR_FIELD_STEP_M)+1)*NEAR_FIELD_STEP_M,
                  np.arange(NEAR_FIELD_REACH_M+5, LOCAL_TERRAIN_REACH_M+1, 5),
                  np.arange(5100, 100001, 100), np.arange(100200, 220001, 200)].astype(float)


def digest(path):
    with path.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()


def longest(flags):
    padded = np.r_[False, flags, False].astype(np.int8)
    changes = np.diff(padded)
    return int((np.where(changes==-1)[0]-np.where(changes==1)[0]).max(initial=0))


def cache_reusable(previous, sources, generator_sha):
    """Derived caches are reusable only under a report made from these sources by this generator."""
    audit = previous.get('audit')
    return (previous.get('version') == 2 and previous.get('sources') == sources
            and isinstance(audit, dict) and audit.get('generatorSha256') == generator_sha)


def run(clone_path=None):
    generator_sha=digest(pathlib.Path(__file__))
    OUT.mkdir(exist_ok=True)
    clone_name = pathlib.Path(clone_path).stem if clone_path else None
    with rasterio.open(CACHE/'Site01_final_adj_5mpp_surf.tif') as ds:
        heights, transform = ds.read(1), ds.transform
    if clone_path:
        with rasterio.open(clone_path) as ds:
            assert ds.shape == heights.shape and ds.transform == transform, 'Clone registration mismatch'
            perturbation = ds.read(1)
            assert np.isfinite(perturbation).all(), 'Missing clone perturbation'
            assert float(np.std(perturbation - heights)) < 100, 'Unexpected clone reference'
            heights = perturbation
    with tarfile.open(CACHE/'Site01_ROIs.tgz') as archive:
        files={m.name.rsplit('.',1)[-1]:archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
        reader=shapefile.Reader(shp=io.BytesIO(files['shp']),shx=io.BytesIO(files['shx']),dbf=io.BytesIO(files['dbf']))
        polygon=shape(reader.shape(3).__geo_interface__)
    minx,miny,maxx,maxy=polygon.bounds
    xs=np.arange(minx,maxx+1,5); ys=np.arange(miny,maxy+1,5)
    x,y=np.meshgrid(xs,ys)
    mask=intersects_xy(polygon,x,y)
    points=np.c_[x[mask],y[mask]]
    assert len(points)==532, f'ROI area mismatch: {len(points)*25} vs published 13300 mÂ²'
    rho=np.hypot(points[:,0],points[:,1])
    lat=-90+np.degrees(2*np.arctan2(rho,2*hz.R_REF))
    lon=np.degrees(np.arctan2(points[:,0],points[:,1]))
    paths=[hz.ROOT/'data/space-cache'/n for n in ['naif0012.tls','pck00011.tpc','moon_pa_de421_1900-2050.bpc','moon_080317.tf']]+[CACHE/'de440s.bsp']
    for path in paths: spice.furnsh(str(path))
    source_paths=paths+[CACHE/'Site01_final_adj_5mpp_surf.tif',CACHE/'Site01_ROIs.tgz',CACHE/'barker2021.pdf',hz.ROOT/'data/dem/ldem_85s_20m.img',hz.ROOT/'data/dem/ldem_75s_120m.img']
    if clone_path: source_paths.append(pathlib.Path(clone_path))
    sources=[{'path':p.name,'sha256':digest(p)} for p in source_paths]
    report_file=OUT/(f'{clone_name}.json' if clone_name else 'barker2021-roi4.json')
    previous=json.loads(report_file.read_text(encoding='utf-8')) if report_file.exists() else {}
    cache_valid=cache_reusable(previous,sources,generator_sha)
    if cache_valid:
        for name, key in [(f'{clone_name}-horizons.npz' if clone_name else 'roi4-horizons.npz', 'horizonCacheSha256'), (f'{clone_name}-sun.npy' if clone_name else 'sun-2024-2026.npy', 'sunCacheSha256')]:
            cached_path = CACHE/name
            if not cached_path.exists() or digest(cached_path) != previous['audit'][key]:
                raise ValueError(f'Derived benchmark cache changed: {name}; refusing unverified reuse')
    start=datetime(2024,1,1); stop=datetime(2026,1,1)
    hours=int((stop-start).total_seconds()/3600)
    vectors_file=CACHE/(f'{clone_name}-sun.npy' if clone_name else 'sun-2024-2026.npy')
    if vectors_file.exists() and cache_valid: sun=np.load(vectors_file)
    else:
        sun=np.array([spice.spkpos('SUN',spice.str2et((start+timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M:%S')),'MOON_ME_DE421','NONE','MOON')[0] for i in range(hours)])
        np.save(vectors_file,sun)
    assert sun.shape==(hours,3) and np.isfinite(sun).all(), 'Invalid Sun vector cache'
    dem20=hz.load_dem(hz.ROOT/'data/dem/ldem_85s_20m.img',20)
    dem120=hz.load_dem(hz.ROOT/'data/dem/ldem_75s_120m.img',120)
    azimuths=np.arange(0,360,.5)
    distances=DISTANCES
    results={1:[],5:[]}
    disc_bounds={1:[],5:[]}
    cache_file=CACHE/(f'{clone_name}-horizons.npz' if clone_name else 'roi4-horizons.npz')
    signature=cache_signature(sources,generator_sha)
    profiles=load_complete(cache_file,532,signature) if cache_valid else None
    profile_cached=profiles is not None
    if not profile_cached: profiles=np.empty((532,2,720))
    partial_file=cache_file.with_suffix('.partial.npz')
    resumed=0
    if not profile_cached:
        partial=load_partial(partial_file,532,signature)
        if partial:
            resumed,prefix=partial; profiles[:resumed]=prefix
            print(f'Resuming horizons at pixel {resumed+1}/532',flush=True)
    if profile_cached:
        assert profiles.shape == (532,2,720) and np.isfinite(profiles).all(), 'Invalid horizon cache'
        assert (profiles[:,1] <= profiles[:,0] + 1e-10).all(), 'Invalid mast horizon ordering'
    def sample(la,lo):
        px,py=hz.latlon_to_px(la,lo,120,dem120[1])
        height=hz.bilinear(dem120[0],px,py)
        px,py=hz.latlon_to_px(la,lo,20,dem20[1])
        inside=np.hypot(px-dem20[1],py-dem20[1])<dem20[0].shape[0]/2-2
        height=np.where(inside,hz.bilinear(dem20[0],px,py),height)
        r=2*hz.R_REF*np.tan((np.radians(la)+np.pi/2)/2)
        xx=r*np.sin(np.radians(lo)); yy=r*np.cos(np.radians(lo))
        sx=(xx-transform.c)/5-.5; sy=(transform.f-yy)/5-.5
        valid=(sx>=0)&(sy>=0)&(sx<heights.shape[1]-1)&(sy<heights.shape[0]-1)&(distances[np.newaxis,:]<=LOCAL_TERRAIN_REACH_M)
        ix=np.clip(np.floor(sx).astype(int),0,heights.shape[1]-2); iy=np.clip(np.floor(sy).astype(int),0,heights.shape[0]-2)
        fx=sx-ix; fy=sy-iy
        local=heights[iy,ix]*(1-fx)*(1-fy)+heights[iy,ix+1]*fx*(1-fy)+heights[iy+1,ix]*(1-fx)*fy+heights[iy+1,ix+1]*fx*fy
        assert np.isfinite(height).all(), 'Missing far-field terrain'
        assert np.isfinite(local[valid]).all(), 'Missing near-field terrain'
        return np.where(valid,local,height)
    for index,(la,lo) in enumerate(zip(lat,lon)):
        col=int(round((points[index,0]-transform.c)/5-.5)); row=int(round((transform.f-points[index,1])/5-.5))
        assert 0 <= row < heights.shape[0] and 0 <= col < heights.shape[1], 'ROI outside source raster'
        centre_x, centre_y = transform * (col + .5, row + .5)
        assert np.allclose([centre_x, centre_y], points[index], atol=1e-7, rtol=0), 'ROI must use original raster centres'
        ground=float(heights[row,col]); assert np.isfinite(ground), 'Missing ROI elevation'
        up=hz.unit(la,lo)
        if not profile_cached and index >= resumed:
            maxima=np.full((2,720),-90.)
            for first in range(0,720,60):
                aa=azimuths[first:first+60,None]
                target_lat,target_lon=hz.destination(la,lo,aa,distances[None,:]/hz.R_REF)
                target=hz.unit(target_lat,target_lon)*(hz.R_REF+sample(target_lat,target_lon))[...,None]
                for j,mast in enumerate((1,5)):
                    ray=target-up*(hz.R_REF+ground+mast)
                    elevation=np.degrees(np.arcsin(np.clip((ray*up).sum(-1)/np.linalg.norm(ray,axis=-1),-1,1)))
                    maxima[j,first:first+60]=elevation.max(axis=1)
            profiles[index]=maxima
            if (index+1)%16==0 or index==531:
                save_partial(partial_file,profiles,index+1,signature)
        a,b=np.radians([la,lo]); east=np.array([-np.sin(b),np.cos(b),0]); north=np.array([-np.sin(a)*np.cos(b),-np.sin(a)*np.sin(b),np.cos(a)])
        for j,mast in enumerate((1,5)):
            sky=sun-up*(hz.R_REF+ground+mast)/1000
            distance=np.linalg.norm(sky,axis=1)
            el=np.degrees(np.arcsin((sky@up)/distance)); az=(np.degrees(np.arctan2(sky@east,sky@north))+360)%360
            horizon=np.interp(az,np.r_[azimuths,360],np.r_[profiles[index,j],profiles[index,j,0]])
            radius=np.degrees(np.arcsin(695700/distance))
            q=np.clip((el-horizon)/radius,-1,1)
            fraction=visible_fraction(q, 0)
            limb_limit=visible_fraction(q, 1)
            assert np.array_equal(fraction > 0, limb_limit > 0), "Disc weighting must not change geometric light/dark classification"
            disc_bounds[mast].append((float(np.minimum(fraction,limb_limit).mean()*100),float(np.maximum(fraction,limb_limit).mean()*100)))
            results[mast].append({'meanPct':float(fraction.mean()*100),'longestDarkDays':longest(fraction<=0)/24,'longestLightDays':longest(fraction>0)/24})
        if index%32==0: print(f'Benchmark pixel {index+1}/532',flush=True)
    if not profile_cached: save_complete(cache_file,profiles,signature)
    published={1:{'meanPct':69.61,'longestDarkDays':13.27,'longestLightDays':136.49},5:{'meanPct':88.12,'longestDarkDays':4.,'longestLightDays':231.20}}
    rows=[]
    for mast in (1,5):
        metrics={k:float(np.mean([r[k] for r in results[mast]])) for k in published[mast]}
        rows.append({'mastHeightM':mast,'nominal':metrics,'published':published[mast],
            'difference':{k:metrics[k]-published[mast][k] for k in metrics}})
    report={'version':2,'createdUTC':datetime.now(timezone.utc).isoformat(),'title':'Barker et al. 2021 Â· Site 1 ROI 4 Â· Table 2, case A',
        'paper':'https://doi.org/10.1016/j.pss.2020.105119','paperUrl':'https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf',
        'dataUrl':'https://pgda.gsfc.nasa.gov/products/78','start':'2024-01-01T00:00:00Z','stop':'2026-01-01T00:00:00Z','hours':hours,
        'pixelCount':532,'pixelScaleM':5,'areaM2':13300,'roiCentroidXYM':[-11287.5,-12167.5],
        'comparisonType':'Nominal regional comparison, not replication of the published uncertainty ensemble',
        'matching':['Published ROI raster centres and area','Two-year interval; hourly half-open sampling','1 m and 5 m observer heights','DE421 Moon mean Earth frame','0.5Â° azimuth horizon sampling'],
        'differences':['One nominal DEM, not 100 uncertainty clones; published illumination and LCIP use the 1st percentile and LCSP the 99th percentile','Uniform solar-disc area weighting instead of published 550 nm limb darkening','5 m near-field through 5 km; 20/120 m far-field through 220 km instead of published 80/240 m products','Geometric DE440 Sun positions; no light-time/aberration or Earth-eclipse mask'],
        'acceptance':'No numerical pass/fail threshold: the nominal mean and an ensemble percentile are different statistics',
        'rows':rows,'sources':sources,'cloneErrorSource':str(clone_path) if clone_path else None,
        'audit': {
            'referenceTable':'Table 2, case A, ROI 4; values checked against rendered page 8',
            'rasterCentresVerified':True,
            'mastHeightMeaning':'Observer height above ground, not terrain pixel resolution',
            'statisticalMismatch':'Nominal regional mean versus 1st/99th percentile across 100 spatially correlated terrain clones',
            'causalStatus':'The paper explains an optimistic nominal bias from near-field horizon uncertainty. Its magnitude has not been isolated in Landsight.',
            'unresolved':['100 original clone calculations', 'Matched 550 nm limb darkening', 'Matched 80/240 m far-field terrain'],
            'pixelMetricRanges': {str(m): {k: {'min':float(min(r[k] for r in results[m])), 'max':float(max(r[k] for r in results[m]))} for k in published[m]} for m in (1,5)},
            'radialSamplingM': {'nearFieldStep':NEAR_FIELD_STEP_M, 'nearFieldReach':NEAR_FIELD_REACH_M, 'localTerrainReach':LOCAL_TERRAIN_REACH_M, 'maximum':float(DISTANCES[-1]), 'sampleCount':int(len(DISTANCES))},
            'horizonCacheSignature':signature,
            'horizonCacheSha256':digest(cache_file),
            'sunCacheSha256':digest(vectors_file),
            'generatorSha256':generator_sha,
            'discDiagnostic': {'model':'Linear limb darkening; all coefficients from 0 to 1, not a matched 550 nm measurement', 'streaksUnchanged':True, 'meanBoundsPct': {str(m): {'lower':float(np.mean([v[0] for v in disc_bounds[m]])), 'upper':float(np.mean([v[1] for v in disc_bounds[m]]))} for m in (1,5)}, 'mathSha256':digest(pathlib.Path(__file__).with_name('benchmark_math.py'))},
        }}
    temporary_report=report_file.with_suffix('.tmp')
    temporary_report.write_text(json.dumps(report,indent=2),encoding='utf-8')
    temporary_report.replace(report_file)
    print(json.dumps(rows,indent=2),flush=True)


if __name__=='__main__': run()
