"""Build sampled landing dispersion masks and georeferenced surface meshes from LOLA.

Run after compute_horizons.py. Never snaps or changes the existing nominal sites.
The 19 samples are the centre, six at 125 m and twelve at 250 m; they do not
constitute a continuous hazard assessment of the landing footprint.
"""
import json
import hashlib
import numpy as np
from compute_horizons import ROOT, OUT, R_REF, load_dem, height_at, horizon_profile, destination, unit


def main():
    cache = {}
    fingerprints = {}
    def dem(name, mpp):
        if name not in cache:
            dn, off, _ = load_dem(ROOT / 'data' / 'dem' / name, mpp)
            cache[name] = (dn, off, mpp, dn.shape[0])
            with (ROOT / 'data' / 'dem' / name).open('rb') as f:
                fingerprints[name] = hashlib.file_digest(f, 'sha256').hexdigest()
        return cache[name]
    coarse = dem('ldem_75s_120m.img', 120)
    for folder in ('dispersion', 'surface'):
        (OUT / folder).mkdir(exist_ok=True)
    for site in json.loads((OUT / 'sites.json').read_text(encoding='utf-8')):
        slug = site['slug']
        nominal = json.loads((OUT / 'horizons' / f'{slug}.json').read_text())
        mpp = 120 if nominal['dem'] == 'ldem_75s_120m' else 20
        primary = coarse if mpp == 120 else dem('ldem_85s_20m.img', 20)
        fallback = coarse if mpp == 20 else None
        samples = [{**nominal, 'eastM': 0, 'northM': 0}]
        for radius, count in ((125, 6), (250, 12)):
            for bearing in np.arange(count) * 360 / count:
                lat, lon = destination(site['lat'], site['lonEast'], bearing, radius / R_REF)
                lat, lon = float(lat), float(lon)
                height = float(height_at(primary, lat, lon))
                profile = horizon_profile(lat, lon, height, primary, fallback)
                samples.append({**nominal, 'lat': lat, 'lonEast': lon,
                    'eastM': round(radius * np.sin(np.radians(bearing)), 3),
                    'northM': round(radius * np.cos(np.radians(bearing)), 3),
                    'siteHeightM': round(height, 3), 'maxHorizonDeg': round(float(profile.max()), 3),
                    'profile': np.round(profile, 3).tolist()})
        source_file = nominal['dem'] + '.img'
        doc = {'version': 1, 'radiusM': 250, 'demResolutionM': mpp, 'demSha256': fingerprints[source_file],
            'nominalHorizonSha256': hashlib.sha256((OUT / 'horizons' / f'{slug}.json').read_bytes()).hexdigest(),
            'sampling': 'centre + 6 points at 125 m + 12 points at 250 m', 'samples': samples}
        (OUT / 'dispersion' / f'{slug}.json').write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')

        # Local east / radial up / south coordinates, in metres, including curvature.
        n = 129 if mpp == 20 else 65
        axis = (np.arange(n) - (n - 1) / 2) * mpp
        east, north = np.meshgrid(axis, -axis)
        distance = np.hypot(east, north)
        bearing = np.degrees(np.arctan2(east, north))
        lat, lon = destination(site['lat'], site['lonEast'], bearing, distance / R_REF)
        from compute_horizons import latlon_to_px, bilinear
        dn, off, _, _ = primary
        sx, sy = latlon_to_px(lat, lon, mpp, off)
        heights = bilinear(dn, sx, sy)
        p0 = unit(site['lat'], site['lonEast'])
        a, b = np.radians([site['lat'], site['lonEast']])
        e = np.array([-np.sin(b), np.cos(b), 0])
        north_axis = np.array([-np.sin(a)*np.cos(b), -np.sin(a)*np.sin(b), np.cos(a)])
        xyz = unit(lat, lon) * (R_REF + heights)[..., None] - p0 * (R_REF + nominal['siteHeightM'])
        mesh = np.stack((xyz @ e, xyz @ p0, -(xyz @ north_axis)), axis=-1)
        mesh.astype('<f4').tofile(OUT / 'surface' / f'{slug}.mesh.bin')
        uv = np.stack((((lon + 180) / 360) % 1, (lat + 90) / 180), axis=-1)
        uv.astype('<f4').tofile(OUT / 'surface' / f'{slug}.uv.bin')
        meta = {'version': 1, 'slug': slug, 'gridSize': n, 'spacingM': mpp,
            'lat': site['lat'], 'lonEast': site['lonEast'], 'heightM': nominal['siteHeightM'],
            'dem': nominal['dem'], 'source': nominal['demSource'], 'frame': 'DE421 mean Earth/polar axis',
            'coordinates': 'metres: east, radial up, south; origin at nominal DEM ground',
            'mesh': f'/data/surface/{slug}.mesh.bin', 'uv': f'/data/surface/{slug}.uv.bin',
            'minHeightM': round(float(heights.min()), 2), 'maxHeightM': round(float(heights.max()), 2)}
        meta['demSha256'] = fingerprints[source_file]
        meta['meshSha256'] = hashlib.sha256((OUT / 'surface' / f'{slug}.mesh.bin').read_bytes()).hexdigest()
        meta['uvSha256'] = hashlib.sha256((OUT / 'surface' / f'{slug}.uv.bin').read_bytes()).hexdigest()
        (OUT / 'surface' / f'{slug}.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
        print(f'{slug}: {len(samples)} horizons, {n}x{n} terrain mesh ({mpp} m)', flush=True)


if __name__ == '__main__':
    main()
