"""Losslessly chunk local NASA elevation products for lazy globe-to-ground LOD."""
import gzip
import hashlib
import json
import numpy as np
import rasterio
from compute_horizons import ROOT, OUT
from scope_terrain_tiles import retained_tiles, scope_metadata


def main():
    folder=OUT/'terrain'; folder.mkdir(exist_ok=True)
    sources=[('global','ldem_16.img',5760,2880,'cylindrical',1895.21),
             ('polar120','ldem_75s_120m.img',None,None,'polar',120),
             ('polar20','ldem_85s_20m.img',None,None,'polar',20),
             ('ridge5','Site01_final_adj_5mpp_surf.tif',3200,3200,'geotiff',5)]
    records=[]; block=512
    sites=json.loads((OUT/'sites.json').read_text())
    for key,name,width,height,projection,spacing in sources:
        path=ROOT/('data/benchmark-cache' if projection=='geotiff' else 'data/dem')/name
        if projection=='geotiff':
            with rasterio.open(path) as source:
                array=source.read(1).astype('<f4'); transform=source.transform
            origin=[transform.c,transform.f]
        else:
            array=np.fromfile(path,dtype='<i2')
            if width is None: width=height=int(round(np.sqrt(array.size)))
            array=array.reshape(height,width); origin=None
        destination=folder/key; destination.mkdir(exist_ok=True)
        record={'key':key,'width':width,'height':height,'projection':projection,
            'spacingM':spacing,'blockSize':block,'sampleBytes':4 if projection=='geotiff' else 2,
            'heightScaleM':1 if projection=='geotiff' else .5,'originXYM':origin,
            'latitudeLimit':-85 if key=='polar20' else -75 if key=='polar120' else None,
            'degreesPerPixel':.0625 if key=='global' else None,'path':f'/data/terrain/{key}',
            'source':name,'frame':'DE421 Moon mean Earth / polar axis',
            'credit':'NASA LRO LOLA; interpolated elevation samples, not metre-scale rocks'}
        keep=retained_tiles(record,[{'spacingM':spec[5]} for spec in sources],sites)
        keep_set=set(keep)
        for y in range(0,height,block):
            for x in range(0,width,block):
                if f'{x//block}-{y//block}' not in keep_set: continue
                # One extra right/bottom sample allows seamless bilinear reads.
                rows=np.minimum(np.arange(y,y+block+1),height-1)
                cols=np.arange(x,x+block+1)
                cols=cols%width if projection=='cylindrical' else np.minimum(cols,width-1)
                tile=array[np.ix_(rows,cols)]
                blob=gzip.compress(tile.tobytes(),compresslevel=6,mtime=0)
                (destination/f'{x//block}-{y//block}.bin.gz').write_bytes(blob)
        with path.open('rb') as f: sha=hashlib.file_digest(f,'sha256').hexdigest()
        record.update(sourceSha256=sha,packagedTiles=keep)
        records.append(record)
        print(f'{key}: {len(keep)} lossless mission-site tiles',flush=True)
    (folder/'manifest.json').write_text(json.dumps({'version':1,'referenceRadiusM':1737400,'datasets':records,'scope':scope_metadata(sites)},indent=2),encoding='utf-8')


if __name__=='__main__': main()
