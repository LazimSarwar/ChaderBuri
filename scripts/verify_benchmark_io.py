"""Bitwise storage/interpolation parity against the original PDS reader."""
import gc,pathlib,numpy as np
import compute_horizons as hz
from benchmark_io import load_dem_mapped
paths=[(hz.ROOT/'data/dem/ldem_85s_20m.img',20),(hz.ROOT/'data/dem/ldem_75s_120m.img',120),
       (hz.ROOT/'data/benchmark-cache/LDEM_80S_80M.IMG',80),(hz.ROOT/'data/benchmark-cache/LDEM_75S_240M.IMG',240)]
checks=0
for path,scale in paths:
    original=hz.load_dem(path,scale);mapped=load_dem_mapped(path,scale)
    assert original[1:]==mapped[1:] and original[0].dtype==mapped[0].dtype
    assert not mapped[0].flags.writeable
    for first in range(0,len(original[0]),64):
        assert np.array_equal(original[0][first:first+64],mapped[0][first:first+64]);checks+=1
    rng=np.random.default_rng(20261014)
    x=rng.uniform(-1,len(original[0]),50000);y=rng.uniform(-1,len(original[0]),50000)
    assert np.array_equal(hz.bilinear(original[0],x,y),hz.bilinear(mapped[0],x,y));checks+=1
    print(f'{path.name}: all stored samples and 50000 interpolations bitwise identical',flush=True)
    del original,mapped;gc.collect()
print(f'I/O parity checks passed: {checks}')
