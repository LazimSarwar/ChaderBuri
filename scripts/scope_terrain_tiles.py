"""Conservatively retain every tile reachable from a supported mission site.

Dry run by default. --apply deletes only unneeded .bin.gz files under the four
terrain dataset directories. Original DEMs, ephemerides, and planet assets stay
untouched. The renderer and this tool share terrain-policy.json.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT/'src/space/terrain-policy.json').read_text())
RADIUS = POLICY['referenceRadiusM']


def reach_m(dataset, datasets):
    """Site-to-camera reach plus a square patch's worst-case diagonal.

    Outer bands use the coarsest source no coarser than their grid spacing.
    Therefore a fine source is never used beyond the next coarser spacing's
    band extent, except the selected innermost band (bounded by altitude).
    """
    if dataset['key'] == 'global':
        half_extent = POLICY['maxPatchHalfExtentM']
    else:
        next_spacing = min(d['spacingM'] for d in datasets if d['spacingM'] > dataset['spacingM'])
        base = math.ceil(POLICY['altitudeLimitsM'][dataset['key']] * POLICY['altitudeSpacingFactor'] / dataset['spacingM']) * dataset['spacingM']
        half_extent = max(next_spacing, base) * POLICY['gridHalfSteps']
    return POLICY['siteRadiusM'] + math.sqrt(2) * half_extent


def angular_distance(lat1, lon1, lat2, lon2):
    a, b, delta = map(math.radians, (lat1, lat2, lon1-lon2))
    dot = math.sin(a)*math.sin(b)+math.cos(a)*math.cos(b)*math.cos(delta)
    return math.acos(max(-1, min(1, dot)))


def polar_geo(x, y):
    return math.degrees(2*math.atan(math.hypot(x,y)/(2*RADIUS)))-90, math.degrees(math.atan2(x,y))


def tile_needed(dataset, tx, ty, sites, radius):
    block = dataset['blockSize']
    x0, x1 = tx*block, min((tx+1)*block, dataset['width']-1)
    y0, y1 = ty*block, min((ty+1)*block, dataset['height']-1)
    if dataset['projection'] == 'cylindrical':
        # All supported sites are southern. Retain every longitude at every
        # tile row intersecting the maximum possible northern patch boundary.
        min_lat = 90-(y1+.5)*dataset['degreesPerPixel']
        return min_lat <= max(s['lat'] for s in sites)+math.degrees(radius/RADIUS)
    mx, my = (x0+x1)/2, (y0+y1)/2
    spacing = dataset['spacingM']
    if dataset['projection'] == 'geotiff':
        x = dataset['originXYM'][0]+(mx+.5)*spacing
        y = dataset['originXYM'][1]-(my+.5)*spacing
    else:
        x = (mx-(dataset['width']-1)/2)*spacing
        y = ((dataset['height']-1)/2-my)*spacing
    lat, lon = polar_geo(x,y)
    # Inverse south-polar stereographic projection has metric scale <= 1.
    # The tile's plane half-diagonal therefore bounds every surface distance
    # from its centre, including its extra interpolation-edge samples.
    tile_radius = math.hypot(x1-x0,y1-y0)*spacing/2
    return any(angular_distance(lat,lon,s['lat'],s['lonEast'])*RADIUS <= radius+tile_radius+1 for s in sites)


def retained_tiles(dataset, datasets, sites):
    radius = reach_m(dataset, datasets)
    return [f'{x}-{y}' for y in range(math.ceil(dataset['height']/dataset['blockSize']))
            for x in range(math.ceil(dataset['width']/dataset['blockSize']))
            if tile_needed(dataset,x,y,sites,radius)]


def scope_metadata(sites):
    return {'kind':'mission-site-surroundings', 'policy':POLICY,
            'sitesSha256':hashlib.sha256((ROOT/'public/data/sites.json').read_bytes()).hexdigest(),
            'sites':[{'slug':s['slug'],'lat':s['lat'],'lonEast':s['lonEast']} for s in sites],
            'method':'Conservative spherical tile bounds; includes surrounding ridges and coarse horizon context.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--preview-manifest', type=Path)
    args = parser.parse_args()
    folder = (ROOT/'public/data/terrain').resolve()
    manifest = json.loads((folder/'manifest.json').read_text(encoding='utf-8-sig'))
    sites = json.loads((ROOT/'public/data/sites.json').read_text())
    assert sites and all(-90 <= s['lat'] < -75 and math.isfinite(s['lonEast']) for s in sites)
    assert {d['key'] for d in manifest['datasets']} == {'global','polar120','polar20','ridge5'}
    report = {'applied':args.apply,'scope':scope_metadata(sites),'datasets':[],'removedFiles':[]}
    targets = []
    for d in manifest['datasets']:
        keep = retained_tiles(d,manifest['datasets'],sites)
        keep_paths = {f'{tile}.bin.gz' for tile in keep}
        dataset_root = (folder/d['key']).resolve()
        assert dataset_root.is_relative_to(folder) and dataset_root.parent == folder
        for name in keep_paths:
            assert (dataset_root/name).is_file(), f'Missing required site tile: {d["key"]}/{name}'
        removed = []
        for path in dataset_root.glob('*.bin.gz'):
            absolute = path.resolve()
            assert absolute.is_relative_to(dataset_root) and absolute.parent == dataset_root
            if path.name not in keep_paths:
                removed.append({'path':str(absolute.relative_to(ROOT)), 'bytes':absolute.stat().st_size})
                targets.append(absolute)
        d['packagedTiles'] = keep
        report['datasets'].append({'key':d['key'],'kept':len(keep),'deleted':len(removed),
                                   'reachM':reach_m(d,manifest['datasets']),
                                   'savedBytes':sum(f['bytes'] for f in removed)})
        report['removedFiles'].extend(removed)
    report['savedBytes'] = sum(d['savedBytes'] for d in report['datasets'])
    manifest['scope'] = report['scope']
    if args.preview_manifest:
        args.preview_manifest.parent.mkdir(parents=True,exist_ok=True)
        args.preview_manifest.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    # All resolved targets have been checked before any mutation.
    if args.apply:
        for path in targets:
            path.unlink()
        (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k in ['applied','datasets','savedBytes']},indent=2))


if __name__ == '__main__':
    main()
