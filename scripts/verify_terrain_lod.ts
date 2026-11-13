import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  TerrainStore,
  terrainPixel,
  datasetContains,
  LUNAR_RADIUS_M,
  type TerrainManifest,
} from '../src/space/terrain.ts'
let checks = 0
const check = (v: boolean, label: string) => {
  checks++
  assert.ok(v, label)
}
const near = (a: number, b: number, tolerance: number, label: string) =>
  check(Math.abs(a - b) < tolerance, `${label}: ${a} vs ${b}`)
const manifest: TerrainManifest = JSON.parse(
  readFileSync('public/data/terrain/manifest.json', 'utf8'),
)
check(
  manifest.datasets.length === 4 &&
    manifest.referenceRadiusM === LUNAR_RADIUS_M,
  'Source datasets and shared radius',
)
const nativeFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const file = readFileSync(`public${String(input)}`)
  return new Response(file)
}
try {
  const store = new TerrainStore(manifest)
  const global = manifest.datasets.find((d) => d.key === 'global')!
  const polar = manifest.datasets.find((d) => d.key === 'polar20')!
  const ridge = manifest.datasets.find((d) => d.key === 'ridge5')!
  const [x, y] = terrainPixel(global, 89.96875, 0.03125)
  near(x, 0, 1e-8, 'Global first pixel centre longitude')
  near(y, 0, 1e-8, 'Global first pixel centre latitude')
  const pole = terrainPixel(polar, -90, 0)
  near(pole[0], (polar.width - 1) / 2, 1e-8, 'Polar centre x')
  near(pole[1], (polar.height - 1) / 2, 1e-8, 'Polar centre y')
  check(
    !datasetContains(polar, -80, 0),
    'Fine polar product cannot silently cover nonpolar ground',
  )
  check(
    store.choose(0, 0, 10).key === 'global',
    'Equatorial ground reports coarse global resolution',
  )
  check(
    store.choose(-85.988, 2.0577, 10).key === 'polar20',
    'Supported polar location uses 20 m detail',
  )
  const points = [
    { lat: -80, lon: 0 },
    { lat: -80, lon: 359.999 },
    { lat: -80, lon: -0.001 },
    { lat: -64, lon: 32.03125 },
    { lat: -70.03125, lon: 128.03125 },
  ]
  await store.ensure(global, points)
  const raw = readFileSync('data/dem/ldem_16.img'),
    samples = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2)
  for (const p of points) {
    let [px, py] = terrainPixel(global, p.lat, p.lon)
    px = (px + global.width) % global.width
    py = Math.max(0, Math.min(global.height - 1.000001, py))
    const a = Math.floor(px),
      b = Math.floor(py),
      fx = px - a,
      fy = py - b
    const at = (xx: number, yy: number) =>
      samples[yy * global.width + (xx % global.width)] * 0.5
    const expected =
      at(a, b) * (1 - fx) * (1 - fy) +
      at(a + 1, b) * fx * (1 - fy) +
      at(a, b + 1) * (1 - fx) * fy +
      at(a + 1, b + 1) * fx * fy
    near(
      store.height(global, p.lat, p.lon)!,
      expected,
      1e-7,
      'Independent source-grid bilinear sampling across tile / longitude seams',
    )
  }
  near(
    store.height(global, -80, 359.999)!,
    store.height(global, -80, -0.001)!,
    1e-7,
    'Longitude wrap continuity',
  )
  for (const d of manifest.datasets) {
    const bytes = gunzipSync(readFileSync(`public${d.path}/${d.packagedTiles?.[0]??'0-0'}.bin.gz`))
    check(
      bytes.length === (d.blockSize + 1) ** 2 * d.sampleBytes,
      'Exact lossless tile dimensions',
    )
  }
  check(
    ridge.sampleBytes === 4 && ridge.heightScaleM === 1,
    'Improved 5 m terrain retains floating-point heights',
  )
  for (const s of JSON.parse(readFileSync('public/data/sites.json', 'utf8'))) {
    const d = store.choose(s.lat, s.lonEast, 10)
    await store.ensure(d, [{ lat: s.lat, lon: s.lonEast }])
    const h = store.height(d, s.lat, s.lonEast)
    check(
      h !== null && Number.isFinite(h),
      'All supported nominal ground locations have measured terrain',
    )
    const nominal = JSON.parse(
      readFileSync(`public/data/horizons/${s.slug}.json`, 'utf8'),
    )
    if (d.source === nominal.dem + '.img')
      near(
        h!,
        s.siteHeightM,
        0.51,
        'Same-product tile height matches nominal DEM elevation',
      )
    else
      check(
        d.spacingM >= 20 || d.key === 'ridge5',
        'Different product / resolution is explicitly identified',
      )
  }
} finally {
  globalThis.fetch = nativeFetch
}
console.log(`Terrain LOD checks passed: ${checks}`)
