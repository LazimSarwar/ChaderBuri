import policy from './terrain-policy.json' with { type: 'json' }
export const TERRAIN_POLICY = policy
export const LUNAR_RADIUS_M = policy.referenceRadiusM
export function nearMissionSite(lat: number, lon: number, sites: {lat:number;lonEast:number}[]): boolean {
  const phi = lat * Math.PI/180, lambda = lon * Math.PI/180
  const threshold = Math.cos(policy.siteRadiusM / LUNAR_RADIUS_M)
  return sites.some(s => {
    const other = s.lat*Math.PI/180
    return Math.sin(phi)*Math.sin(other)+Math.cos(phi)*Math.cos(other)*Math.cos(lambda-s.lonEast*Math.PI/180) >= threshold
  })
}
export type TerrainDataset = {
  key: string
  width: number
  height: number
  projection: 'cylindrical' | 'polar' | 'geotiff'
  spacingM: number
  blockSize: number
  sampleBytes: number
  heightScaleM: number
  originXYM: number[] | null
  latitudeLimit: number | null
  degreesPerPixel: number | null
  path: string
  source: string
  sourceSha256: string
  frame: string
  credit: string
  /** Explicit shipped tile IDs; source-grid coordinates and hashes stay intact. */
  packagedTiles?: string[]
}
export type TerrainManifest = {
  version: number
  referenceRadiusM: number
  datasets: TerrainDataset[]
}
export type GeoPoint = { lat: number; lon: number }
export function polarXY(lat: number, lon: number): [number, number] {
  const r = 2 * LUNAR_RADIUS_M * Math.tan(((lat + 90) * Math.PI) / 360)
  return [
    r * Math.sin((lon * Math.PI) / 180),
    r * Math.cos((lon * Math.PI) / 180),
  ]
}
export function terrainPixel(
  d: TerrainDataset,
  lat: number,
  lon: number,
): [number, number] {
  if (d.projection === 'cylindrical')
    return [
      (((lon % 360) + 360) % 360) / d.degreesPerPixel! - 0.5,
      (90 - lat) / d.degreesPerPixel! - 0.5,
    ]
  const [x, y] = polarXY(lat, lon)
  return d.projection === 'geotiff'
    ? [
        (x - d.originXYM![0]) / d.spacingM - 0.5,
        (d.originXYM![1] - y) / d.spacingM - 0.5,
      ]
    : [(d.width - 1) / 2 + x / d.spacingM, (d.height - 1) / 2 - y / d.spacingM]
}
export function datasetContains(
  d: TerrainDataset,
  lat: number,
  lon: number,
  marginM = 0,
): boolean {
  if (d.projection === 'cylindrical') return true
  if (
    d.latitudeLimit !== null &&
    lat > d.latitudeLimit - ((marginM / LUNAR_RADIUS_M) * 180) / Math.PI
  )
    return false
  const [x, y] = terrainPixel(d, lat, lon),
    m = marginM / d.spacingM
  return x >= m && y >= m && x < d.width - 1 - m && y < d.height - 1 - m
}
export class TerrainStore {
  private tiles = new Map<string, Int16Array | Float32Array>()
  private pending = new Map<string, Promise<void>>()
  public manifest: TerrainManifest
  private packaged = new Map<string, Set<string>>()
  constructor(manifest: TerrainManifest) {
    this.manifest = manifest
    for (const d of manifest.datasets) if (d.packagedTiles) this.packaged.set(d.key, new Set(d.packagedTiles))
  }
  choose(lat: number, lon: number, altitudeM: number): TerrainDataset {
    const choices = ['ridge5', 'polar20', 'polar120', 'global']
    const limit: Record<string, number> = policy.altitudeLimitsM
    return choices
      .map((k) => this.manifest.datasets.find((d) => d.key === k)!)
      .find(
        (d) =>
          altitudeM < limit[d.key] &&
          datasetContains(d, lat, lon, Math.max(100, altitudeM * 0.8)),
      )!
  }
  forSpacing(spacing: number, point: GeoPoint): TerrainDataset {
    return (
      this.manifest.datasets
        .filter(
          (d) =>
            d.spacingM <= Math.max(5, spacing) &&
            datasetContains(d, point.lat, point.lon),
        )
        .sort((a, b) => b.spacingM - a.spacingM)[0] ??
      this.manifest.datasets.find((d) => d.key === 'global')!
    )
  }
  private tileKey(d: TerrainDataset, x: number, y: number) {
    return `${d.key}/${Math.floor(x / d.blockSize)}-${Math.floor(y / d.blockSize)}`
  }
  private coordinate(d: TerrainDataset, lat: number, lon: number) {
    let [x, y] = terrainPixel(d, lat, lon)
    x =
      d.projection === 'cylindrical'
        ? ((x % d.width) + d.width) % d.width
        : Math.max(0, Math.min(d.width - 1.000001, x))
    y = Math.max(0, Math.min(d.height - 1.000001, y))
    return [x, y]
  }
  async ensure(d: TerrainDataset, points: GeoPoint[]): Promise<void> {
    const keys = new Set(
      points.map((p) => {
        const [x, y] = this.coordinate(d, p.lat, p.lon)
        return this.tileKey(d, x, y)
      }),
    )
    for (const key of keys) {
      if (this.packaged.has(d.key) && !this.packaged.get(d.key)!.has(key.slice(key.indexOf('/')+1)))
        throw new Error(`Terrain region is outside supported mission-site coverage: ${key}`)
    }
    const jobs = [...keys].map(async (key) => {
      if (this.tiles.has(key)) return
      if (this.pending.has(key)) return this.pending.get(key)
      const job = (async () => {
        const r = await fetch(`/data/terrain/${key}.bin.gz`)
        if (!r.ok) throw new Error(`Terrain tile unavailable: ${key}`)
        let bytes = await r.arrayBuffer()
        const header = new Uint8Array(bytes)
        if (header[0] === 31 && header[1] === 139)
          bytes = await new Response(
            new Blob([bytes])
              .stream()
              .pipeThrough(new DecompressionStream('gzip')),
          ).arrayBuffer()
        if (bytes.byteLength !== (d.blockSize + 1) ** 2 * d.sampleBytes)
          throw new Error(`Incomplete terrain tile: ${key}`)
        this.tiles.set(
          key,
          d.sampleBytes === 4 ? new Float32Array(bytes) : new Int16Array(bytes),
        )
      })()
      this.pending.set(key, job)
      try {
        await job
      } finally {
        this.pending.delete(key)
      }
    })
    await Promise.all(jobs)
  }
  height(d: TerrainDataset, lat: number, lon: number): number | null {
    if (!datasetContains(d, lat, lon)) return null
    const [x, y] = this.coordinate(d, lat, lon),
      tile = this.tiles.get(this.tileKey(d, x, y))
    if (!tile) return null
    const n = d.blockSize + 1,
      xx = x % d.blockSize,
      yy = y % d.blockSize,
      a = Math.floor(xx),
      b = Math.floor(yy),
      fx = xx - a,
      fy = yy - b
    const h =
      (tile[b * n + a] * (1 - fx) * (1 - fy) +
        tile[b * n + a + 1] * fx * (1 - fy) +
        tile[(b + 1) * n + a] * (1 - fx) * fy +
        tile[(b + 1) * n + a + 1] * fx * fy) *
      d.heightScaleM
    return Number.isFinite(h) ? h : null
  }
  bestHeight(lat: number, lon: number): number | null {
    for (const d of [...this.manifest.datasets].sort(
      (a, b) => a.spacingM - b.spacingM,
    )) {
      const h = this.height(d, lat, lon)
      if (h !== null) return h
    }
    return null
  }
}
let pending: Promise<TerrainStore> | undefined
export function loadTerrain(): Promise<TerrainStore> {
  return (pending ??= fetch('/data/terrain/manifest.json')
    .then((r) => {
      if (!r.ok) throw new Error('Terrain manifest unavailable')
      return r.json()
    })
    .then((m) => new TerrainStore(m))
    .catch((e) => {
      pending = undefined
      throw e
    }))
}
