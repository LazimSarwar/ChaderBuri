"""Add reproducible height sensitivity and actual ten-minute Horizons transition probes.
Production ephemerides, terrain tiles, nominal horizons and published benchmarks remain untouched.
"""
import datetime as dt, hashlib, json, math, pathlib, time, urllib.parse, urllib.request
import numpy as np
import compute_horizons as hz
from fetch_ephemeris import parse
ROOT=pathlib.Path(__file__).resolve().parents[1];DATA=ROOT/'public/data';OUT=DATA/'validation'
def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def epoch(t):return dt.datetime.strptime(t,'%Y-%b-%d %H:%M').replace(tzinfo=dt.timezone.utc)
def mapped(name,mpp):
    path=ROOT/'data/dem'/name;n=math.isqrt(path.stat().st_size//2)
    if n*n*2!=path.stat().st_size:raise ValueError('Invalid square DEM')
    return (np.memmap(path,dtype='<i2',mode='r',shape=(n,n)),n/2-.5,mpp,n)
def main():
    OUT.mkdir(exist_ok=True);(OUT/'sites').mkdir(exist_ok=True)
    sites=json.loads((DATA/'sites.json').read_text());coarse=mapped('ldem_75s_120m.img',120);fine=mapped('ldem_85s_20m.img',20)
    dem_hash={name:sha(ROOT/'data/dem'/name) for name in ['ldem_75s_120m.img','ldem_85s_20m.img']}
    for site in sites:
        slug=site['slug'];path=DATA/'horizons'/f'{slug}.json';base=json.loads(path.read_text());primary=coarse if base['dem'].endswith('120m') else fine
        heights=[]
        for mast in [0,1,3,5]:
            profile=hz.horizon_profile(site['lat'],site['lonEast'],base['siteHeightM']+mast,primary,None if primary is coarse else coarse)
            if mast==0:
                residual=float(np.abs(profile-np.array(base['profile'])).max())
                if residual>.011:raise ValueError(f'{slug}: nominal horizon drift {residual}')
                profile=np.array(base['profile'])
            heights.append({'observerHeightM':mast,'profile':np.round(profile,5).tolist()})
        report={'schemaVersion':1,'slug':slug,'generatedUTC':dt.datetime.now(dt.timezone.utc).isoformat(),'nominalHorizonSha256':sha(path),'demSha256':dem_hash[base['dem']+'.img'],'nominalRecomputeMaxDeg':residual,'profiles':heights,
          'method':'Same LOLA DEM and 360-bearing / 160 km horizon march at 0, 1, 3 and 5 m above nominal ground. Diagnostic height sensitivity, not independent terrain-accuracy validation.'}
        (OUT/'sites'/f'{slug}.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf-8');print('Height sensitivity:',slug,flush=True)
    # New, finer source samples around actual cached Sun/Earth horizon transitions.
    cases=[]
    for slug in ['shackleton-rim','malapert-massif','de-gerlache-rim']:
        site=next(s for s in sites if s['slug']==slug);h=json.loads((DATA/'horizons'/f'{slug}.json').read_text())
        for body,code in [('sun','10'),('earth','399')]:
            cached=json.loads((DATA/'ephemeris'/f'{slug}.{body}.json').read_text());rows=cached['rows'];start=epoch(rows[0]['t'])
            mask=np.array(h['profile']);clear=np.array([r['el']-mask[int(math.floor(r['az']+.5))%360] for r in rows])
            crossings=np.flatnonzero((clear[:-1]>0)!=(clear[1:]>0))+1
            earliest=int((dt.datetime(2026,10,17,tzinfo=dt.timezone.utc)-start).total_seconds()/3600)
            crossings=crossings[crossings>=earliest]
            if not len(crossings):continue
            at=int(crossings[0]);lo=max(0,at-12);hi=min(len(rows)-1,at+12)
            params={'format':'text','COMMAND':f"'{code}'",'EPHEM_TYPE':'OBSERVER','CENTER':"'coord@301'",'COORD_TYPE':'GEODETIC','SITE_COORD':f"'{site['lonEast']%360:.4f},{site['lat']:.4f},{h['siteHeightM']/1000:.6f}'",'START_TIME':epoch(rows[lo]['t']).strftime("'%Y-%m-%d %H:%M'"),'STOP_TIME':epoch(rows[hi]['t']).strftime("'%Y-%m-%d %H:%M'"),'STEP_SIZE':"'10m'",'QUANTITIES':"'4,13,20'",'EXTRA_PREC':'YES'}
            url='https://ssd.jpl.nasa.gov/api/horizons.api?'+urllib.parse.urlencode(params)
            try:
                with urllib.request.urlopen(url,timeout=30) as response:raw=response.read().decode('utf-8')
                samples=parse(raw)
                if len(samples)!=(hi-lo)*6+1 or 'MEAN_ME' not in raw:raise ValueError('Unexpected Horizons sample count/frame')
                case={'slug':slug,'body':body,'sourceURL':url,'retrievedUTC':dt.datetime.now(dt.timezone.utc).isoformat(),'rawSha256':hashlib.sha256(raw.encode()).hexdigest(),'cachedEphemerisSha256':sha(DATA/'ephemeris'/f'{slug}.{body}.json'),'nominalHorizonSha256':sha(DATA/'horizons'/f'{slug}.json'),'startRow':lo,'stopRow':hi,'stepMinutes':10,'samples':samples,'status':'complete'}
                print('Actual 10-minute source probe:',slug,body,len(samples),flush=True)
            except Exception as error:
                case={'slug':slug,'body':body,'sourceURL':url,'status':'unavailable','error':str(error)};print('Source probe unavailable:',slug,body,str(error),flush=True)
            cases.append(case);time.sleep(.7)
    doc={'schemaVersion':1,'createdUTC':dt.datetime.now(dt.timezone.utc).isoformat(),'cases':cases,'method':'New ten-minute JPL Horizons source queries around six selected terrain-mask transitions; source/time-sampling check, not independent astronomy or terrain validation. Cases are selected from cached transitions and do not bound all dates/sites.'}
    (OUT/'transitions.json').write_text(json.dumps(doc,indent=1),encoding='utf-8')
if __name__=='__main__':main()
