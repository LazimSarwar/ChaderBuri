"""Read-only memory mapping: same PDS sample bytes, dtype and projection metadata."""
import math
import numpy as np
from compute_horizons import R_REF


def load_dem_mapped(path,m_per_px):
    raw=np.memmap(path,dtype='<i2',mode='r')
    n=int(round(np.sqrt(raw.size)))
    if n*n!=raw.size:raise ValueError(f'{path.name}: not square ({raw.size} samples)')
    return raw.reshape(n,n),n/2.0-.5,math.degrees((n*m_per_px)/(2.0*R_REF))
