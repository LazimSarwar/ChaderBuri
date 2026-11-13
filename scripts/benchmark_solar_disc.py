"""550 nm sensitivity model from Pierce & Slaughter 1977 Table IV, Eq. 11.
Barker specifies 550 nm but does not specify coefficients. This is a documented
wavelength-matched model, not a claim to reproduce the authors' private code.
"""
import numpy as np
from scipy.special import betaincc

SOURCE_URL='https://articles.adsabs.harvard.edu/pdf/1977SoPh...51...25P'
# Visually transcribed from printed p.39, Table IV; wavelengths in nm.
TABLE={541.760:[.22874,1.54025,-2.15443,2.84347,-2.07225,.61421],
       552.200:[.24092,1.61047,-2.79815,4.46819,-3.75831,1.23687]}
WAVELENGTH_NM=550.0
ALPHA=(WAVELENGTH_NM-541.760)/(552.200-541.760)
COEFFICIENTS=(1-ALPHA)*np.array(TABLE[541.760])+ALPHA*np.array(TABLE[552.200])


def visible_fraction_550(clearance_ratio):
    """Integrate projected disk brightness above the horizontal terrain horizon.

    I(mu)=sum(a[k]*mu**k), mu=sqrt(1-x*x-y*y).
    Each basis strip has an exact normalized beta CDF. Horizon is y=-q.
    """
    q=np.clip(np.asarray(clearance_ratio,dtype=float),-1.,1.)
    weights=COEFFICIENTS/(np.arange(6)+2)
    # The complementary CDF preserves tiny first/last exposed crescents.
    tails=np.array([.5*betaincc(.5,(k+3)/2,q*q) for k in range(6)])
    cumulative=np.where(q<0,tails,1-tails)
    return np.clip(np.einsum('k,k...->...',weights,cumulative)/weights.sum(),0.,1.)


def metadata():
    return {'wavelengthNm':WAVELENGTH_NM,'source':SOURCE_URL,'table':'Table IV, equation 11, printed p.39',
        'sourceRows':{str(k):v for k,v in TABLE.items()},'coefficients':COEFFICIENTS.tolist(),
        'interpolation':'Linear coefficient interpolation between 541.760 and 552.200 nm',
        'integration':'Projected-disk horizontal cut; analytic regularized beta integrals',
        'replicationLimit':'Barker does not identify the exact 550 nm coefficient set; author implementation equivalence unverified'}
