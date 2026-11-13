"""Radial terrain sampling of the Barker ROI4 benchmark: one definition, fine enough near field.

"Converged" here means only that sampling the interpolated 5 m surface more finely barely
changes the horizon; it says nothing about the accuracy of the terrain itself.

With 5 m radial steps the horizon search stepped over sub-pixel peaks of the bilinear 5 m
surface and the 1 m results came out ~0.5 pp too bright (docs/BENCHMARK_AUDIT.md). This
guards the fix: every benchmark path uses build_benchmark.DISTANCES, and halving its
near-field step no longer moves any sampled horizon by more than TOLERANCE_DEG.
"""
import io
import pathlib
import tarfile
import unittest
import numpy as np
import build_benchmark as b
import build_benchmark_matched as matched
import verify_benchmark_geometry as proof

hz = b.hz
SURFACE = b.CACHE / 'Site01_final_adj_5mpp_surf.tif'
TOLERANCE_DEG = .02      # 0.25 m steps: 0.016 deg at worst; 0.5 m steps: 0.030 deg
MEAN_TOLERANCE_DEG = .00025


class SamplingDefinition(unittest.TestCase):
    def test_one_definition_everywhere(self):
        self.assertIs(proof.DIST, b.DISTANCES, 'paired geometry kernel must use the benchmark sampling')
        namespace = {'__name__': 'matched_snapshot_check', '__file__': str(matched.WORK / 'build_matched_snapshot.py')}
        exec(compile(matched.snapshot_source(), 'build_matched_snapshot.py', 'exec'), namespace)
        np.testing.assert_array_equal(namespace['DISTANCES'], b.DISTANCES)
        for path in pathlib.Path(__file__).parent.glob('*benchmark*.py'):
            if path.name in ('build_benchmark.py', pathlib.Path(__file__).name): continue
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('np.arange(5100', text, f'{path.name} defines its own radial samples')

    def test_shape_of_the_sampling(self):
        d = b.DISTANCES
        self.assertTrue((np.diff(d) > 0).all(), 'strictly increasing')
        self.assertEqual(d[0], b.NEAR_FIELD_STEP_M)
        self.assertEqual(d[-1], 220000)
        near = d[d <= b.NEAR_FIELD_REACH_M]
        self.assertEqual(near[-1], b.NEAR_FIELD_REACH_M)
        np.testing.assert_allclose(np.diff(near), b.NEAR_FIELD_STEP_M, rtol=0, atol=1e-12)
        self.assertLessEqual(b.NEAR_FIELD_STEP_M, .25)
        # A superset of the original 5 m / 100 m / 200 m samples: refined horizons can only rise.
        old = np.r_[np.arange(5, 5001, 5), np.arange(5100, 100001, 100), np.arange(100200, 220001, 200)]
        self.assertTrue(np.isin(old, d).all())


@unittest.skipUnless(SURFACE.exists(), 'benchmark cache (5 m ROI4 surface) not present')
class NearFieldConvergence(unittest.TestCase):
    """Halving the configured near-field step on real ROI pixels barely moves the horizon."""

    @classmethod
    def setUpClass(cls):
        import rasterio, shapefile
        from shapely.geometry import shape
        from shapely import intersects_xy
        with rasterio.open(SURFACE) as ds: cls.heights, cls.transform = ds.read(1), ds.transform
        with tarfile.open(b.CACHE / 'Site01_ROIs.tgz') as archive:
            files = {m.name.rsplit('.', 1)[-1]: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
            reader = shapefile.Reader(shp=io.BytesIO(files['shp']), shx=io.BytesIO(files['shx']), dbf=io.BytesIO(files['dbf']))
            polygon = shape(reader.shape(3).__geo_interface__)
        minx, miny, maxx, maxy = polygon.bounds
        x, y = np.meshgrid(np.arange(minx, maxx + 1, 5), np.arange(miny, maxy + 1, 5)); mask = intersects_xy(polygon, x, y)
        cls.points = np.c_[x[mask], y[mask]]
        assert len(cls.points) == 532

    def horizon(self, index, distances):
        """Near-field horizon of one ROI pixel, with build_benchmark's local interpolation."""
        t, heights = self.transform, self.heights
        px, py = self.points[index]
        lat = -90 + np.degrees(2 * np.arctan2(np.hypot(px, py), 2 * hz.R_REF)); lon = np.degrees(np.arctan2(px, py))
        col = int(round((px - t.c) / 5 - .5)); row = int(round((t.f - py) / 5 - .5))
        ground = float(heights[row, col]); up = hz.unit(lat, lon); out = np.empty((2, 720))
        for first in range(0, 720, 60):
            aa = np.arange(first, first + 60)[:, None] * .5
            tl, tn = hz.destination(lat, lon, aa, distances[None, :] / hz.R_REF)
            r = 2 * hz.R_REF * np.tan((np.radians(tl) + np.pi / 2) / 2)
            sx = (r * np.sin(np.radians(tn)) - t.c) / 5 - .5; sy = (t.f - r * np.cos(np.radians(tn))) / 5 - .5
            ix = np.floor(sx).astype(int); iy = np.floor(sy).astype(int); fx = sx - ix; fy = sy - iy
            local = heights[iy, ix] * (1 - fx) * (1 - fy) + heights[iy, ix + 1] * fx * (1 - fy) + heights[iy + 1, ix] * (1 - fx) * fy + heights[iy + 1, ix + 1] * fx * fy
            target = hz.unit(tl, tn) * (hz.R_REF + local)[..., None]
            for j, mast in enumerate((1, 5)):
                ray = target - up * (hz.R_REF + ground + mast)
                out[j, first:first + 60] = np.degrees(np.arcsin(np.clip((ray * up).sum(-1) / np.linalg.norm(ray, axis=-1), -1, 1))).max(axis=1)
        return out

    def test_halving_the_near_field_step_changes_little(self):
        near = b.DISTANCES[b.DISTANCES <= b.NEAR_FIELD_REACH_M]
        halved = np.sort(np.r_[near, near - b.NEAR_FIELD_STEP_M / 2])
        changes = np.array([self.horizon(i, halved) - self.horizon(i, near) for i in np.linspace(0, 531, 8).astype(int)])
        self.assertGreaterEqual(changes.min(), -1e-12, 'a superset of samples cannot lower the horizon')
        self.assertLess(changes.max(), TOLERANCE_DEG, f'largest change {changes.max():.4f} deg')
        self.assertLess(changes.mean(), MEAN_TOLERANCE_DEG, f'mean change {changes.mean():.5f} deg')


if __name__ == '__main__': unittest.main()
