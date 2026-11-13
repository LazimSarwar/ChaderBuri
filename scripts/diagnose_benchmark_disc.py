"""Isolate 550 nm disk weighting while holding audited horizons fixed."""
import io,json,tarfile
import numpy as np
import rasterio,shapefile
from shapely.geometry import shape
from shapely import intersects_xy
import build_benchmark as benchmark
from benchmark_math import visible_fraction
from benchmark_solar_disc import visible_fraction_550,metadata
CACHE=benchmark.CACHE
hz=benchmark.hz


def run(clone=None):
    stem=f'Site01_final_adj_5mpp_{clone:04d}_err' if clone else None
    terrain=CACHE/'clones'/(stem+'.tif') if clone else CACHE/'Site01_final_adj_5mpp_surf.tif'
    profiles_file=CACHE/(stem+'-horizons.npz' if stem else 'roi4-horizons.npz')
    sun_file=CACHE/(stem+'-sun.npy' if stem else 'sun-2024-2026.npy')
    if not profiles_file.exists(): return None
    with rasterio.open(terrain) as ds: heights,transform=ds.read(1),ds.transform
    with tarfile.open(CACHE/'Site01_ROIs.tgz') as archive:
        files={m.name.rsplit('.',1)[-1]:archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
        reader=shapefile.Reader(shp=io.BytesIO(files['shp']),shx=io.BytesIO(files['shx']),dbf=io.BytesIO(files['dbf']))
        polygon=shape(reader.shape(3).__geo_interface__)
    minx,miny,maxx,maxy=polygon.bounds
    x,y=np.meshgrid(np.arange(minx,maxx+1,5),np.arange(miny,maxy+1,5)); mask=intersects_xy(polygon,x,y)
    points=np.c_[x[mask],y[mask]];assert len(points)==532
    lat=-90+np.degrees(2*np.arctan2(np.linalg.norm(points,axis=1),2*hz.R_REF))
    lon=np.degrees(np.arctan2(points[:,0],points[:,1]))
    profiles=np.load(profiles_file)['profiles'];sun=np.load(sun_file)
    metrics={1:[],5:[]}
    for index,(la,lo) in enumerate(zip(lat,lon)):
        col=int(round((points[index,0]-transform.c)/5-.5));row=int(round((transform.f-points[index,1])/5-.5))
        ground=float(heights[row,col]);up=hz.unit(la,lo)
        a,b=np.radians([la,lo]);east=np.array([-np.sin(b),np.cos(b),0]);north=np.array([-np.sin(a)*np.cos(b),-np.sin(a)*np.sin(b),np.cos(a)])
        for j,mast in enumerate((1,5)):
            sky=sun-up*(hz.R_REF+ground+mast)/1000;distance=np.linalg.norm(sky,axis=1)
            el=np.degrees(np.arcsin((sky@up)/distance));az=(np.degrees(np.arctan2(sky@east,sky@north))+360)%360
            horizon=np.interp(az,np.arange(0,360.5,.5),np.r_[profiles[index,j],profiles[index,j,0]])
            q=np.clip((el-horizon)/np.degrees(np.arcsin(695700/distance)),-1,1)
            uniform=visible_fraction(q);weighted=visible_fraction_550(q)
            assert np.array_equal(uniform>0,weighted>0),'Unexpected geometric streak change'
            metrics[mast].append([uniform.mean()*100,weighted.mean()*100])
    return {'clone':clone,'pixelCount':532,'rows':[{'mastHeightM':m,'uniformPct':float(np.mean(metrics[m],axis=0)[0]),
                'weighted550Pct':float(np.mean(metrics[m],axis=0)[1]),'changePp':float(np.mean(metrics[m],axis=0)[1]-np.mean(metrics[m],axis=0)[0])} for m in (1,5)],
            'streaksUnchanged':True,'sources':[{'path':p.name,'sha256':benchmark.digest(p)} for p in (terrain,profiles_file,sun_file,CACHE/'pierce1977.pdf')]}

if __name__=='__main__':
    result={'model':metadata(),'comparisons':[r for r in (run(),run(1)) if r], 'purpose':'Weighting-only sensitivity; no far-field or ensemble change'}
    (CACHE/'disc-550-diagnostic.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result['comparisons'],indent=2))
