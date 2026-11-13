"""Isolated paired-clone geometry reuse proof. Does not modify live runs."""
import io,json,pathlib,tarfile,time
import numpy as np,rasterio,shapefile
from shapely.geometry import shape
from shapely import intersects_xy
import build_benchmark as b
from benchmark_io import load_dem_mapped
from benchmark_math import visible_fraction
from benchmark_solar_disc import visible_fraction_550
hz=b.hz;CACHE=b.CACHE;OUT=CACHE/'geometry-proof'
DIST=b.DISTANCES  # one radial sampling definition, owned by build_benchmark.py


def geometry(la,lo,first,transform,shape_,dems,mode):
    aa=np.arange(first,first+60)[:,None]*.5
    lat,lon=hz.destination(la,lo,aa,DIST[None,:]/hz.R_REF)
    r=2*hz.R_REF*np.tan((np.radians(lat)+np.pi/2)/2);xx=r*np.sin(np.radians(lon));yy=r*np.cos(np.radians(lon))
    sx=(xx-transform.c)/5-.5;sy=(transform.f-yy)/5-.5
    valid=(sx>=0)&(sy>=0)&(sx<shape_[1]-1)&(sy<shape_[0]-1)&(DIST[None,:]<=b.LOCAL_TERRAIN_REACH_M)
    ix=np.clip(np.floor(sx).astype(int),0,shape_[1]-2);iy=np.clip(np.floor(sy).astype(int),0,shape_[0]-2)
    # Far-field terrain only where the clone raster does not supply the height: block() never reads
    # it elsewhere (np.where(valid,local,height)). The lookups are element-wise, so these are the
    # values of the full-array calculation; main() checks every horizon bit for bit. ~23% faster.
    far=~valid;flat,flon=lat[far],lon[far]
    coarse,fine=dems;coarse_scale,fine_scale=(120,20) if mode=='reference' else (240,80)
    px,py=hz.latlon_to_px(flat,flon,coarse_scale,coarse[1]);far_height=hz.bilinear(coarse[0],px,py)
    px,py=hz.latlon_to_px(flat,flon,fine_scale,fine[1]);inside=np.hypot(px-fine[1],py-fine[1])<fine[0].shape[0]/2-2
    if mode=='matched':inside&=np.broadcast_to(DIST[None,:],lat.shape)[far]<=100000
    height=np.zeros(lat.shape);height[far]=np.where(inside,hz.bilinear(fine[0],px,py),far_height)
    return hz.unit(lat,lon),height,ix,iy,sx-ix,sy-iy,valid


def block(g,heights,ground,up):
    unit,height,ix,iy,fx,fy,valid=g
    local=heights[iy,ix]*(1-fx)*(1-fy)+heights[iy,ix+1]*fx*(1-fy)+heights[iy+1,ix]*(1-fx)*fy+heights[iy+1,ix+1]*fx*fy
    assert np.isfinite(height).all() and np.isfinite(local[valid]).all()
    target=unit*(hz.R_REF+np.where(valid,local,height))[...,None]
    result=[]
    for mast in (1,5):
        ray=target-up*(hz.R_REF+ground+mast)
        elevation=np.degrees(np.arcsin(np.clip((ray*up).sum(-1)/np.linalg.norm(ray,axis=-1),-1,1)))
        result.append(elevation.max(axis=1))
    return np.array(result)


def profile(la,lo,grounds,heights,transform,dems,mode,reuse):
    up=hz.unit(la,lo);result=np.empty((2,2,720))
    for first in range(0,720,60):
        shared=geometry(la,lo,first,transform,heights[0].shape,dems,mode) if reuse else None
        for i in range(2):
            g=shared if reuse else geometry(la,lo,first,transform,heights[i].shape,dems,mode)
            result[i,:,first:first+60]=block(g,heights[i],grounds[i],up)
    return result


def calculation_sha(mode):
    """Fingerprint of the calculation whose stored horizons and reports this proof matches.

    A worker may only use the paired kernel for that exact calculation; any change to
    build_benchmark.py (including its radial sampling) needs a fresh proof."""
    if mode=='reference':return b.digest(pathlib.Path(b.__file__))
    import build_benchmark_matched as matched
    snapshot=matched.WORK/'build_matched_snapshot.py'
    if not snapshot.exists() or snapshot.read_text(encoding='utf-8')!=matched.snapshot_source():
        raise ValueError('Matched snapshot is not derived from the current build_benchmark.py; run the matched clones 1-2 first')
    return b.digest(snapshot)


def main():
    OUT.mkdir(exist_ok=True)
    for mode in ('reference','matched'):calculation_sha(mode)  # fail before hours of work, not after
    with tarfile.open(CACHE/'Site01_ROIs.tgz') as archive:
        files={m.name.rsplit('.',1)[-1]:archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
        reader=shapefile.Reader(shp=io.BytesIO(files['shp']),shx=io.BytesIO(files['shx']),dbf=io.BytesIO(files['dbf']))
        poly=shape(reader.shape(3).__geo_interface__)
    minx,miny,maxx,maxy=poly.bounds;x,y=np.meshgrid(np.arange(minx,maxx+1,5),np.arange(miny,maxy+1,5));mask=intersects_xy(poly,x,y);points=np.c_[x[mask],y[mask]]
    assert len(points)==532
    lat=-90+np.degrees(2*np.arctan2(np.hypot(points[:,0],points[:,1]),2*hz.R_REF));lon=np.degrees(np.arctan2(points[:,0],points[:,1]))
    heights=[];clonepaths=[]
    for i in (1,2):
        p=CACHE/'clones'/f'Site01_final_adj_5mpp_{i:04d}_err.tif';clonepaths.append(p)
        with rasterio.open(p) as ds:
            heights.append(ds.read(1));transform=ds.transform
    summaries=[]
    for mode in ('reference','matched'):
        prefix='' if mode=='reference' else 'matched-'
        paths=[hz.ROOT/'data/dem/ldem_75s_120m.img',hz.ROOT/'data/dem/ldem_85s_20m.img'] if mode=='reference' else [CACHE/'LDEM_75S_240M.IMG',CACHE/'LDEM_80S_80M.IMG']
        scales=(120,20) if mode=='reference' else (240,80);dems=[load_dem_mapped(p,s) for p,s in zip(paths,scales)]
        goldpaths=[CACHE/f'{prefix}{p.stem}-horizons.npz' for p in clonepaths]
        gold=[np.load(p)['profiles'] for p in goldpaths]
        sun=np.load(CACHE/(clonepaths[0].stem+'-sun.npy'))
        metrics=[{m:[] for m in (1,5)} for _ in range(2)];probe=[];start=time.perf_counter()
        for index,(la,lo) in enumerate(zip(lat,lon)):
            col=int(round((points[index,0]-transform.c)/5-.5));row=int(round((transform.f-points[index,1])/5-.5));grounds=[float(h[row,col]) for h in heights]
            if index<4:
                t=time.perf_counter();original=profile(la,lo,grounds,heights,transform,dems,mode,False);original_seconds=time.perf_counter()-t
            t=time.perf_counter();reused=profile(la,lo,grounds,heights,transform,dems,mode,True);reused_seconds=time.perf_counter()-t
            if index<4:
                assert np.array_equal(original,reused),'Paired kernel mismatch'
                probe.append({'pixel':index,'originalSeconds':original_seconds,'reusedSeconds':reused_seconds})
            for i in range(2):
                assert np.array_equal(reused[i],gold[i][index]),f'{mode} clone {i+1} pixel {index}: cached horizon mismatch'
                up=hz.unit(la,lo);a,bb=np.radians([la,lo]);east=np.array([-np.sin(bb),np.cos(bb),0]);north=np.array([-np.sin(a)*np.cos(bb),-np.sin(a)*np.sin(bb),np.cos(a)])
                for j,mast in enumerate((1,5)):
                    sky=sun-up*(hz.R_REF+grounds[i]+mast)/1000;distance=np.linalg.norm(sky,axis=1);el=np.degrees(np.arcsin((sky@up)/distance));az=(np.degrees(np.arctan2(sky@east,sky@north))+360)%360
                    horizon=np.interp(az,np.arange(0,360.5,.5),np.r_[reused[i,j],reused[i,j,0]])
                    q=np.clip((el-horizon)/np.degrees(np.arcsin(695700/distance)),-1,1)
                    f=visible_fraction(q,0) if mode=='reference' else visible_fraction_550(q)
                    metrics[i][mast].append({'meanPct':float(f.mean()*100),'longestDarkDays':b.longest(f<=0)/24,'longestLightDays':b.longest(f>0)/24})
            if index%16==0:
                print(mode,'verified pixel',index+1,'/532',flush=True)
                (OUT/'progress.json').write_text(json.dumps({'mode':mode,'verifiedPixels':index+1,'totalPixels':532,'probeTimings':probe}),encoding='utf-8')
        reportfolder=CACHE/'ensemble' if mode=='reference' else CACHE/'matched/ensemble'
        for i,p in enumerate(clonepaths):
            report=json.loads((reportfolder/(p.stem+'.json')).read_text(encoding='utf-8'))
            for row in report['rows']:
                m=row['mastHeightM'];actual={k:float(np.mean([r[k] for r in metrics[i][m]])) for k in row['nominal']}
                assert actual==row['nominal'],f'{mode} clone {i+1}: metric mismatch'
        summaries.append({'mode':mode,'pixelCount':532,'cloneIds':[1,2],'horizonsBitwiseEqual':True,'allSixRegionalMetricsExactlyEqual':True,'elapsedSeconds':time.perf_counter()-start,'probeTimings':probe,
            'calculationSha256':calculation_sha(mode),
            'sources':[{'path':p.name,'sha256':b.digest(p)} for p in paths+clonepaths+goldpaths]})
        (OUT/(mode+'-result.json')).write_text(json.dumps(summaries[-1],indent=2),encoding='utf-8')
        del gold,dems
    (OUT/'complete.json').write_text(json.dumps({'verified':True,'generatorSha256':b.digest(pathlib.Path(__file__)),'results':summaries},indent=2),encoding='utf-8')
    print('Both geometry reuse proofs completed exactly',flush=True)

if __name__=='__main__':main()
