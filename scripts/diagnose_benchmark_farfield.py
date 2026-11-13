"""Terrain-only horizon sensitivity at the published ROI4 centroid.
This is a single observer diagnostic, not an ensemble or regional result.
"""
import json
import numpy as np
import rasterio
import build_benchmark as benchmark
hz=benchmark.hz;CACHE=benchmark.CACHE


def run():
    names=[('reference20',hz.ROOT/'data/dem/ldem_85s_20m.img',20),
           ('reference120',hz.ROOT/'data/dem/ldem_75s_120m.img',120),
           ('legacy80',CACHE/'LDEM_80S_80M.IMG',80),('legacy240',CACHE/'LDEM_75S_240M.IMG',240)]
    dems={key:(hz.load_dem(path,scale),scale) for key,path,scale in names}
    x,y=-11287.5,-12167.5
    lat=-90+np.degrees(2*np.arctan2(np.hypot(x,y),2*hz.R_REF));lon=np.degrees(np.arctan2(x,y));up=hz.unit(lat,lon)
    with rasterio.open(CACHE/'Site01_final_adj_5mpp_surf.tif') as ds:
        col=int(round((x-ds.transform.c)/5-.5));row=int(round((ds.transform.f-y)/5-.5));ground=float(ds.read(1)[row,col])
    distances=benchmark.DISTANCES[benchmark.DISTANCES>benchmark.LOCAL_TERRAIN_REACH_M]  # far field only
    horizons={key:{m:[] for m in (1,5)} for key in ('reference','legacy')}
    for first in range(0,720,60):
        aa=np.arange(first,first+60)[:,None]*.5
        la,lo=hz.destination(lat,lon,aa,distances[None,:]/hz.R_REF)
        samples={}
        for key,(dem,scale) in dems.items():
            px,py=hz.latlon_to_px(la,lo,scale,dem[1]);samples[key]=hz.bilinear(dem[0],px,py)
        dem=dems['reference20'][0];px,py=hz.latlon_to_px(la,lo,20,dem[1])
        inside=np.hypot(px-dem[1],py-dem[1])<dem[0].shape[0]/2-2
        elevation={'reference':np.where(inside,samples['reference20'],samples['reference120']),
                   'legacy':np.where(distances[None,:]<=100000,samples['legacy80'],samples['legacy240'])}
        for key,height in elevation.items():
            target=hz.unit(la,lo)*(hz.R_REF+height)[...,None]
            for mast in (1,5):
                ray=target-up*(hz.R_REF+ground+mast)
                el=np.degrees(np.arcsin(np.clip((ray*up).sum(-1)/np.linalg.norm(ray,axis=-1),-1,1)))
                horizons[key][mast].extend(el.max(axis=1))
    return {'observer':'ROI4 published centroid only','centroidXYM':[x,y],'nearFieldExcludedM':5000,
            'rows':[{'mastHeightM':m,'legacyMinusReferenceDeg':{'min':float(np.min(np.array(horizons['legacy'][m])-horizons['reference'][m])),
                    'max':float(np.max(np.array(horizons['legacy'][m])-horizons['reference'][m])),
                    'mean':float(np.mean(np.array(horizons['legacy'][m])-horizons['reference'][m]))}} for m in (1,5)],
            'sources':[{'path':p.name,'sha256':benchmark.digest(p)} for _,p,_ in names]}

if __name__=='__main__':
    result=run();(CACHE/'farfield-diagnostic.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
