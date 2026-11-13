"""Separate reproducible 80/240 m + 550 nm ensemble experiment.
Freeze the running reference algorithm before controlled substitutions. Never
mutate build_benchmark.py while its original-clone run is active. The generated
snapshot is an audited source file, not a runtime patch to the web application.
"""
import hashlib
import importlib.util
import json
import pathlib
import sys
import numpy as np
import build_benchmark as reference
import build_benchmark_ensemble as ensemble
from benchmark_solar_disc import metadata

ROOT=reference.hz.ROOT
CACHE=reference.CACHE
WORK=CACHE/'matched'


def snapshot_source():
    source=pathlib.Path(reference.__file__).read_text(encoding='utf-8')
    def replace(old,new):
        nonlocal source
        if source.count(old)!=1:
            raise ValueError('Reference algorithm changed; review controlled substitution: '+old[:60])
        source=source.replace(old,new)
    replace('from benchmark_math import visible_fraction','from benchmark_math import visible_fraction\nfrom benchmark_solar_disc import visible_fraction_550, metadata')
    replace("clone_name = pathlib.Path(clone_path).stem if clone_path else None", "clone_name = 'matched-'+(pathlib.Path(clone_path).stem if clone_path else 'nominal')")
    # Distinct derived cache keys; runner keeps report basename as clone source.
    replace("report_file=OUT/(f'{clone_name}.json' if clone_name else 'barker2021-roi4.json')", "report_file=OUT/(f'{pathlib.Path(clone_path).stem}.json' if clone_path else 'barker2021-roi4.json')")
    replace("hz.ROOT/'data/dem/ldem_85s_20m.img',hz.ROOT/'data/dem/ldem_75s_120m.img'", "CACHE/'LDEM_80S_80M.IMG',CACHE/'LDEM_75S_240M.IMG',CACHE/'LDEM_80S_80M.LBL',CACHE/'LDEM_75S_240M.LBL',pathlib.Path(__file__).parents[3]/'scripts/benchmark_solar_disc.py',CACHE/'pierce1977.pdf'")
    replace("dem20=hz.load_dem(hz.ROOT/'data/dem/ldem_85s_20m.img',20)", "dem20=hz.load_dem(CACHE/'LDEM_80S_80M.IMG',80)")
    replace("dem120=hz.load_dem(hz.ROOT/'data/dem/ldem_75s_120m.img',120)", "dem120=hz.load_dem(CACHE/'LDEM_75S_240M.IMG',240)")
    replace('hz.latlon_to_px(la,lo,120,dem120[1])','hz.latlon_to_px(la,lo,240,dem120[1])')
    replace('hz.latlon_to_px(la,lo,20,dem20[1])','hz.latlon_to_px(la,lo,80,dem20[1])')
    replace('inside=np.hypot(px-dem20[1],py-dem20[1])<dem20[0].shape[0]/2-2', 'inside=(distances[np.newaxis,:]<=100000)&(np.hypot(px-dem20[1],py-dem20[1])<dem20[0].shape[0]/2-2)')
    replace('fraction=visible_fraction(q, 0)','fraction=visible_fraction_550(q)')
    replace('assert np.array_equal(fraction > 0, limb_limit > 0), \"Disc weighting must not change geometric light/dark classification\"', 'assert np.array_equal(fraction > 0, q > -1), \"Solar weighting lost a positive geometric crescent\"')
    replace("'Uniform solar-disc area weighting instead of published 550 nm limb darkening'", "'550 nm Pierce & Slaughter Table IV interpolation; exact author coefficient choice unverified'")
    replace("'5 m near-field through 5 km; 20/120 m far-field through 220 km instead of published 80/240 m products'", "'Legacy PDS V2.0 80/240 m terrain; exact author archive release and radial sampling unverified'")
    # Existing endpoint diagnostic is not meaningful for a polynomial law.
    start=source.index("            'discDiagnostic':")
    end=source.index('\n        }}',start)
    source=source[:start]+"            'solarDisc':metadata(), 'mathSha256':digest(pathlib.Path(__file__).parents[3]/'scripts/benchmark_solar_disc.py'),"+source[end:]
    return source


def prepare():
    WORK.mkdir(exist_ok=True)
    for name,n,scale in [('LDEM_80S_80M',7600,80),('LDEM_75S_240M',3812,240)]:
        p=CACHE/(name+'.IMG')
        if p.stat().st_size!=n*n*2: raise ValueError('Terrain length mismatch')
        label=(CACHE/(name+'.LBL')).read_text(encoding='utf-8')
        import re
        for key,value in [('SCALING_FACTOR',.5),('OFFSET',1737400.),('MAP_SCALE',scale),('CENTER_LATITUDE',-90)]:
            match=re.search(r'\b'+key+r'\s*=\s*([-+0-9.]+)',label)
            if not match or float(match.group(1))!=value: raise ValueError('Unsupported PDS label: '+key)
        if 'LSB_INTEGER' not in label or 'MEAN EARTH/POLAR AXIS OF DE421' not in label: raise ValueError('Unsupported terrain frame/encoding')
    path=WORK/'build_matched_snapshot.py'
    source=snapshot_source()
    if not path.exists() or path.read_text(encoding='utf-8')!=source:
        path.write_text(source,encoding='utf-8')
    spec=importlib.util.spec_from_file_location('matched_benchmark',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    ensemble.benchmark=module
    ensemble.CHECKPOINTS=WORK/'ensemble'
    ensemble.CACHE_PREFIX='matched-'
    ensemble.FINAL_OUTPUT=ROOT/'public/data/benchmark/barker2021-roi4-matched-ensemble.json'
    ensemble.LIMITS=['Exact Barker solar coefficients unverified; documented Pierce & Slaughter 550 nm model',
                    'Legacy PDS 80/240 m grids; exact author archive release and radial sampling unverified',
                    'Geometric DE440 vectors']
    return module


if __name__=='__main__':
    prepare()
    ensemble.main()
