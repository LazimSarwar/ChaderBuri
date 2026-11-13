"""Original Barker ROI4 ensemble; resumable controlled comparison.
Uses authors' full perturbed elevation rasters directly (despite _err names). Remaining far-field and
solar-disc differences are explicit; this is not an exact paper replication.
"""
import argparse, hashlib, json, pathlib, time, os
import requests
import rasterio
import numpy as np
import build_benchmark as benchmark
ROOT = benchmark.hz.ROOT
CACHE = benchmark.CACHE
CLONES = CACHE/'clones'
CHECKPOINTS = CACHE/'ensemble'
BASE = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Clones/'
CACHE_PREFIX=''
FINAL_OUTPUT=ROOT/'public/data/benchmark/barker2021-roi4-ensemble.json'
LIMITS=['Uniform solar disk, not matched 550 nm limb darkening','20/120 m far-field, not original 80/240 m products','Geometric DE440 vectors']

def atomic_json(path, value):
    tmp = path.with_name(path.name+f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value,indent=2),encoding='utf-8')
    tmp.replace(path)

def validate_report(report, index, generator_sha, source_sha):
    """Refuse mixed methods, stale implementations, and missing clone sources."""
    filename=f'Site01_final_adj_5mpp_{index:04d}_err.tif'
    if report.get('pendingCalculation') is not None:
        raise ValueError('Unfinished benchmark report: the calculation was interrupted')
    if report.get('version') != 2 or report.get('pixelCount') != 532 or report.get('hours') != 17544:
        raise ValueError('Unexpected benchmark geometry or sampling')
    if report.get('start') != '2024-01-01T00:00:00Z' or report.get('stop') != '2026-01-01T00:00:00Z':
        raise ValueError('Unexpected benchmark interval')
    audit=report.get('audit',{})
    if audit.get('generatorSha256') != generator_sha:
        raise ValueError('Stale benchmark generator')
    if not any(x.get('path')==filename and x.get('sha256')==source_sha for x in report.get('sources',[])):
        raise ValueError('Clone source fingerprint mismatch')
    rows=report.get('rows',[])
    if sorted(r['mastHeightM'] for r in rows) != [1,5]:
        raise ValueError('Missing or duplicate observer heights')
    for row in rows:
        values=row['nominal']
        if set(values) != {'meanPct','longestLightDays','longestDarkDays'}:
            raise ValueError('Unexpected ensemble metric')
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('Nonfinite ensemble metric')
        if not 0 <= values['meanPct'] <= 100 or not all(0 <= values[k] <= 731 for k in ('longestLightDays','longestDarkDays')):
            raise ValueError('Out-of-range ensemble metric')
    return report


def aggregate_reports(reports):
    if len(reports) != 100:
        raise ValueError('Only a complete 100-clone ensemble can be published')
    common=lambda r: [(s['path'],s['sha256']) for s in r['sources'] if not s['path'].endswith('_err.tif')]
    if any(common(r) != common(reports[0]) for r in reports):
        raise ValueError('Mixed non-clone source data')
    for key in ('matching','differences','start','stop','pixelCount','hours'):
        if any(r[key] != reports[0][key] for r in reports):
            raise ValueError(f'Mixed comparison configuration: {key}')
    metrics=[json.dumps(sorted((r['mastHeightM'],sorted(r['nominal'].items())) for r in report['rows'])) for report in reports]
    if len(set(metrics)) != len(metrics):
        raise ValueError('Two clones report identical metrics; one report was copied, not calculated')
    rows=[]
    for height in (1,5):
        data=[next(r for r in report['rows'] if r['mastHeightM']==height) for report in reports]
        reference=data[0]['published']
        if any(r['published'] != reference for r in data):
            raise ValueError('Mixed published reference values')
        metrics={key:float(np.percentile([r['nominal'][key] for r in data],99 if key=='longestDarkDays' else 1,method='linear')) for key in data[0]['nominal']}
        rows.append({'mastHeightM':height,'ensemblePercentile':metrics,'published':reference,'difference':{k:metrics[k]-reference[k] for k in metrics}})
    return rows


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--first',type=int,default=1)
    parser.add_argument('--last',type=int,default=100)
    args=parser.parse_args()
    if not 1<=args.first<=args.last<=100: raise ValueError('Clone IDs must be 1..100')
    CLONES.mkdir(exist_ok=True); CHECKPOINTS.mkdir(exist_ok=True)
    benchmark.OUT=CHECKPOINTS
    for index in range(args.first,args.last+1):
        filename=f'Site01_final_adj_5mpp_{index:04d}_err.tif'
        path=CLONES/filename; url=BASE+filename
        if not path.exists():
            temporary=path.with_name(path.name+f'.{os.getpid()}.download')
            with requests.get(url,stream=True,timeout=(20,90)) as response:
                response.raise_for_status()
                with temporary.open('wb') as out:
                    for chunk in response.iter_content(1024*1024): out.write(chunk)
            with rasterio.open(temporary) as ds:
                errors=ds.read(1)
                if ds.shape!=(3200,3200) or not np.isfinite(errors).all(): raise ValueError('Invalid source error raster')
                with rasterio.open(CACHE/'Site01_final_adj_5mpp_surf.tif') as nominal:
                    if ds.transform != nominal.transform or float(np.std(errors-nominal.read(1)))>100:
                        raise ValueError('Clone registration/reference mismatch')
            try:
                os.link(temporary,path)  # create-if-absent; no worker overwrites another source
            except FileExistsError:
                if benchmark.digest(temporary)!=benchmark.digest(path):
                    raise ValueError('Concurrent clone downloads differ; refusing mixed source')
            finally:
                temporary.unlink(missing_ok=True)
        sha=benchmark.digest(path)
        report=CHECKPOINTS/(path.stem+'.json')
        valid=False
        if report.exists():
            try:
                prior=json.loads(report.read_text(encoding='utf-8'))
                validate_report(prior,index,benchmark.digest(pathlib.Path(benchmark.__file__)),sha)
                valid=True
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                valid=False
        if not valid:
            print(f'Computing original clone {index}/100',flush=True)
            benchmark.run(path)
        progress={'lastCompleted':index,'requested':[args.first,args.last],'source':BASE,'completedAtUnix':time.time()}
        atomic_json(CHECKPOINTS/f'progress-{args.first}-{args.last}.json',progress)
        if args.first==1: atomic_json(CHECKPOINTS/'progress.json',progress)
    reports=[]
    for index in range(1,101):
        p=CHECKPOINTS/f'Site01_final_adj_5mpp_{index:04d}_err.json'
        if not p.exists(): return
        report=validate_report(json.loads(p.read_text(encoding='utf-8')),index,benchmark.digest(pathlib.Path(benchmark.__file__)),benchmark.digest(CLONES/f'Site01_final_adj_5mpp_{index:04d}_err.tif'))
        for suffix,key in (('-horizons.npz','horizonCacheSha256'),('-sun.npy','sunCacheSha256')):
            if benchmark.digest(CACHE/(CACHE_PREFIX+p.stem+suffix)) != report['audit'][key]:
                raise ValueError('Derived clone cache fingerprint mismatch')
        reports.append(report)
    rows=aggregate_reports(reports)
    output={'cloneCount':100,'aggregation':'Table 2 A: average pixel metrics within each clone, then percentile across clones; NumPy linear quantile',
      'rows':rows,'limits':LIMITS,
      'sources':[{'id':i+1,'url':BASE+f'Site01_final_adj_5mpp_{i+1:04d}_err.tif','sha256':benchmark.digest(CLONES/f'Site01_final_adj_5mpp_{i+1:04d}_err.tif')} for i in range(100)]}
    atomic_json(FINAL_OUTPUT,output)
    print('Complete original 100-clone controlled comparison',flush=True)

if __name__=='__main__': main()
