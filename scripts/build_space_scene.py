"""Build reproducible geometric scene ephemerides; independent of mission calculations.

Requires requests, numpy, spiceypy, Pillow. Vectors: JPL Horizons, ICRF, geometric,
parent-centred, UTC, positions km and velocities km/s. Hermite-friendly samples.
Attitudes/radii/GM: NAIF kernels. Assets are downloaded unchanged from NASA and
Solar System Scope (CC BY 4.0), with per-file attribution and hashes.
Run python scripts/build_space_scene.py. Raw responses/kernels are cached locally.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import time
import urllib.parse
from datetime import datetime, timezone

import numpy as np
import requests
import spiceypy as spice
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/space-cache'
OUT = ROOT / 'public/data/space'
TEX = ROOT / 'public/textures/space'
START, STOP, HOURS = '2026-09-01', '2028-12-31', 20448
# name, id, parent, cadence hours, NASA texture directory
BODIES = [
    ('Sun',10,None,6,None), ('Mercury',199,'Sun',6,None),
    ('Venus',299,'Sun',6,None), ('Earth',399,'Sun',6,None),
    ('Moon',301,'Earth',1,None), ('Mars',499,'Sun',6,'Mars'),
    ('Jupiter',599,'Sun',6,None), ('Saturn',699,'Sun',6,None),
    ('Uranus',799,'Sun',6,None), ('Neptune',899,'Sun',6,'Neptune'),
    ('Phobos',401,'Mars',.5,'Mars - Phobos'), ('Deimos',402,'Mars',1,'Mars - Deimos'),
    ('Io',501,'Jupiter',1,'Jupiter - Io (A)'), ('Europa',502,'Jupiter',1,'Jupiter - Europa'),
    ('Ganymede',503,'Jupiter',1,'Jupiter - Ganymede'), ('Callisto',504,'Jupiter',2,'Jupiter - Callisto'),
    ('Enceladus',602,'Saturn',1,'Saturn - Enceladus'), ('Titan',606,'Saturn',2,'Saturn - Titan'),
    ('Titania',703,'Uranus',2,'Uranus - Titania'), ('Oberon',704,'Uranus',2,'Uranus - Oberon'),
    ('Triton',801,'Neptune',1,'Neptune - Triton'),
]
IDS = {b[0]:b[1] for b in BODIES}
SSS = {'Mercury':('2k_mercury.jpg','mercury.jpg'), 'Uranus':('2k_uranus.jpg','uranus.jpg'),
       'Sun':('8k_sun.jpg','sun.jpg'),
       'Moon':('2k_moon.jpg','moon-map.jpg'), 'Venus':('2k_venus_atmosphere.jpg','venus-clouds.jpg'),
       'Saturn':('2k_saturn.jpg','saturn-map.jpg'), 'Jupiter':('2k_jupiter.jpg','jupiter-map.jpg'),
       'Saturn rings':('2k_saturn_ring_alpha.png','saturn-rings.png')}
BASE = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'
KERNELS = ['lsk/naif0012.tls','pck/pck00011.tpc','pck/gm_de440.tpc',
           'pck/moon_pa_de421_1900-2050.bpc','fk/satellites/moon_080317.tf']


def download(url, dest):
    if dest.exists(): return dest.read_bytes()
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=(20,120)); r.raise_for_status()
            data = r.content
            dest.parent.mkdir(parents=True,exist_ok=True)
            tmp = dest.with_suffix(dest.suffix+'.part'); tmp.write_bytes(data); tmp.replace(dest)
            return data
        except requests.RequestException:
            if attempt == 3: raise
            time.sleep(2 * (attempt+1))


def vectors(body):
    name, ident, parent, step, _ = body
    n = int(HOURS/step)+1
    if not parent: return np.zeros((n,6)), None
    params = dict(format='text',COMMAND=str(ident),CENTER=f'500@{IDS[parent]}',
                  EPHEM_TYPE='VECTORS',START_TIME=START,STOP_TIME=STOP,
                  STEP_SIZE=f'{round(step*60)}m',REF_PLANE='FRAME',REF_SYSTEM='ICRF',
                  VEC_TABLE='2',VEC_CORR='NONE',OUT_UNITS='KM-S',TIME_TYPE='UT',CSV_FORMAT='YES')
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?'+urllib.parse.urlencode(params)
    raw = download(url, CACHE / f'{name}-vectors.txt')
    txt = raw.decode('utf-8')
    if '$$SOE' not in txt: raise ValueError(f'{name}: {txt[-1500:]}')
    rows = []
    for line in txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
        fields = line.split(',')
        rows.append([float(v) for v in fields[2:8]])
    arr = np.asarray(rows,dtype='<f8')
    assert arr.shape == (n,6), (name,arr.shape,n)
    assert np.isfinite(arr).all()
    print(name, len(rows), 'vectors',flush=True)
    return arr, dict(url=url,rawSha256=hashlib.sha256(raw).hexdigest(),
                     retrievedUTC=datetime.fromtimestamp((CACHE/f'{name}-vectors.txt').stat().st_mtime,timezone.utc).isoformat())


def assets():
    records=[]
    nasa='https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/'
    for name,_,_,_,folder in BODIES:
        if not folder: continue
        url=nasa+urllib.parse.quote(folder+'/'+folder+'.jpg')
        data=download(url,TEX/f'{name.lower()}.jpg')
        records.append(dict(body=name,path=f'/textures/space/{name.lower()}.jpg',url=url,
                            credit='NASA 3D Resources; historical/composite texture, not live imagery',
                            sha256=hashlib.sha256(data).hexdigest()))
        print(name,'texture',len(data),flush=True)
    # SSS publishes this pack under CC BY 4.0. Colors/gap fills are authored;
    # these appearance maps do not supply positions or mission measurements.
    for name,(file,local) in SSS.items():
        url='https://www.solarsystemscope.com/textures/download/'+file
        data=download(url,TEX/local)
        records.append(dict(body=name,path=f'/textures/space/{local}',url=url,
            credit='Solar System Scope / INOVE, CC BY 4.0; authored appearance map based on NASA imagery; unchanged',
            license='https://creativecommons.org/licenses/by/4.0/',licenseSource='https://ssi.solarsystemscope.com/textures/',
            sha256=hashlib.sha256(data).hexdigest()))
    (OUT/'assets.json').write_text(json.dumps(records,indent=2))
    for record in records:
        if record['body']=='Saturn rings': continue
        with Image.open(ROOT/'public'/record['path'].lstrip('/')) as im:
            assert im.width==2*im.height, f"Not a spherical equirectangular map: {record['body']}"


def main():
    CACHE.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True); TEX.mkdir(parents=True,exist_ok=True)
    provenance=[]
    for path in KERNELS:
        dest=CACHE/path.split('/')[-1]
        raw=download(BASE+path,dest); spice.furnsh(str(dest))
        provenance.append(dict(url=BASE+path,sha256=hashlib.sha256(raw).hexdigest()))
    # UTC converted by SPICE to ephemeris seconds before attitude evaluation.
    from datetime import timedelta
    times=[spice.str2et((datetime(2026,9,1)+timedelta(hours=h)).strftime('%Y-%m-%d %H:%M:%S UTC')) for h in range(HOURS+1)]
    # Three sphere: local X = lon 0, local Y = north, local -Z = lon 90 E.
    local_to_fixed=np.array([[1,0,0],[0,0,-1],[0,1,0]],dtype=float)
    inertial_to_scene=local_to_fixed.T
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        asset_job=pool.submit(assets)
        jobs={b[0]:pool.submit(vectors,b) for b in BODIES}
        entries=[]
        for b in BODIES:
            name,ident,parent,step,texture=b
            arr,source=jobs[name].result()
            arr.tofile(OUT/f'{name.lower()}.vectors.bin')
            frame='MOON_ME_DE421' if name=='Moon' else 'IAU_'+name.upper()
            qs=[]
            for et in times:
                rot=inertial_to_scene @ spice.pxform(frame,'J2000',et) @ local_to_fixed
                q=spice.m2q(rot) # scalar-first SPICE -> Three scalar-last
                qs.append([q[1],q[2],q[3],q[0]])
            np.asarray(qs,dtype='<f4').tofile(OUT/f'{name.lower()}.attitude.bin')
            radii=spice.bodvrd(name,'RADII',3)[1]
            try: gm=float(spice.bodvrd(str(IDS[parent]),'GM',1)[1][0]) if parent else None
            except Exception: raise
            entries.append(dict(name=name,id=ident,parent=parent,stepHours=step,count=len(arr),
                radiusKm=round(float(np.cbrt(np.prod(radii))),4),radiiKm=radii.tolist(),parentGM=gm,
                bodyGM=float(spice.bodvrd(str(ident),'GM',1)[1][0]),
                vectors=f'/data/space/{name.lower()}.vectors.bin',attitude=f'/data/space/{name.lower()}.attitude.bin',
                attitudeStepHours=1,attitudeCount=len(qs),attitudeFrame=frame,
                texture=f'/textures/space/{SSS[name][1]}' if name in SSS else f'/textures/space/{name.lower()}.jpg' if texture else None,source=source))
            print(name,'attitude and radii ready',flush=True)
        asset_job.result()
    doc=dict(version=1,start=START+'T00:00:00Z',stop=STOP+'T00:00:00Z',hours=HOURS,
             frame='ICRF / J2000',timeScale='UTC (SPICE converts UTC to ET for orientation)',
             correction='Geometric simultaneous states; no light-time or aberration',
             interpolation='Cubic Hermite position/velocity; quaternion slerp orientation',
             kernels=provenance,bodies=entries)
    (OUT/'manifest.json').write_text(json.dumps(doc,indent=2))
    print('DONE',len(entries),'bodies',flush=True)


if __name__=='__main__': main()
