"""Sampler and projection regression checks; not a terrain accuracy benchmark."""
import numpy as np
from compute_horizons import bilinear, latlon_to_px, px_to_latlon, horizon_profile, R_REF

# Pixel centres must reproduce their values exactly, with no half-pixel shift.
raster = np.arange(25, dtype=np.int16).reshape(5, 5)
for y in range(4):
    for x in range(4):
        assert bilinear(raster, np.asarray([x]), np.asarray([y]))[0] == raster[y, x] * .5
assert bilinear(raster, np.asarray([1.5]), np.asarray([1.5]))[0] == 4.5
for lat, lon in [(-89.936, -137.5077), (-85.2327, 36.595), (-80.3, 1.3)]:
    x, y = latlon_to_px(lat, lon, 20, 7583.5)
    actual = px_to_latlon(x, y, 20, 7583.5)
    assert abs(actual[0] - lat) < 1e-9
    assert abs(((actual[1] - lon + 180) % 360) - 180) < 1e-9

# On a zero-height spherical DEM, the nearest sample defines a small negative
# geometric horizon, equal to minus half its central angle.
flat = (np.zeros((400, 400), dtype=np.int16), 199.5, 1000., 400)
profile = horizon_profile(-90., 0., 0., flat, None)
expected = -np.degrees(50 / R_REF) / 2
assert np.max(np.abs(profile - expected)) < 1e-6
print('Terrain regression checks passed: pixel centres, bilinear interpolation, projection round trips and a spherical analytic horizon.')
