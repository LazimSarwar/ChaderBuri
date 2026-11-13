"""Independent quadrature checks for the wavelength-matched sensitivity model."""
import unittest
import numpy as np
from scipy.integrate import quad
from scipy.special import gamma
from benchmark_solar_disc import COEFFICIENTS,visible_fraction_550

class DiscChecks(unittest.TestCase):
    def test_full_half_empty(self):
        np.testing.assert_allclose(visible_fraction_550([-1,0,1]),[0,.5,1],atol=1e-14)
    def test_positive_physical_intensity(self):
        intensity=np.polynomial.polynomial.polyval(np.linspace(0,1,10001),COEFFICIENTS)
        self.assertTrue(np.all(intensity>0)); self.assertTrue(np.all(np.diff(intensity)>=0))
    def test_mirror_and_monotonic(self):
        q=np.linspace(-1,1,10001); f=visible_fraction_550(q)
        np.testing.assert_allclose(f+f[::-1],1,atol=3e-14)
        self.assertTrue(np.all(np.diff(f)>=0))
    def test_independent_strip_quadrature(self):
        # No beta CDF: numerical integral of the analytical brightness strip.
        constants=[np.sqrt(np.pi)*gamma(k/2+1)/gamma(k/2+1.5) for k in range(6)]
        def strip(y):
            return sum(a*c*max(0,1-y*y)**((k+1)/2) for k,(a,c) in enumerate(zip(COEFFICIENTS,constants)))
        total=quad(strip,-1,1,epsabs=1e-11)[0]
        for q in np.linspace(-.999,.999,41):
            self.assertAlmostEqual(float(visible_fraction_550(q)),quad(strip,-q,1,epsabs=1e-11)[0]/total,places=9)
    def test_tiny_crescent_remains_visible(self):
        q=np.array([np.nextafter(-1.,0.),-1+1e-12,-1+1e-9])
        self.assertTrue(np.all(visible_fraction_550(q)>0))
        self.assertEqual(float(visible_fraction_550(-1)),0)

    def test_geometric_streaks_preserved(self):
        q=np.array([-1,-.999999,-.2,0,.1,.99999,1])
        np.testing.assert_array_equal(visible_fraction_550(q)>0,q>-1)

if __name__=='__main__': unittest.main()
