import type { TerrainSampler } from './terrainGrid.ts'
/** A separate metre-space mesh: a tracked 1 m head movement must remain 1 m, not a lunar scene unit. */
export function xrTerrain(sample: TerrainSampler, centre: { eastM: number; northM: number }, resolutionM: number, extentM = 120) {
  const origin = sample(centre.eastM, centre.northM)
  if (origin === null || !Number.isFinite(origin)) return null
  const step = Math.max(5, Number.isFinite(resolutionM) && resolutionM > 0 ? resolutionM : 20), n = Math.floor(2 * extentM / step) + 1
  const positions: number[] = [], known: boolean[] = [], indices: number[] = []
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const east = -extentM + x * step, north = extentM - z * step
    const h = sample(centre.eastM + east, centre.northM + north), valid = h !== null && Number.isFinite(h)
    positions.push(east, valid ? h - origin : 0, -north); known.push(valid)
  }
  for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
    const a = z * n + x, b = a + 1, c = a + n, d = c + 1
    if (known[a] && known[b] && known[c]) indices.push(a, c, b)
    if (known[b] && known[c] && known[d]) indices.push(b, c, d)
  }
  return { positions, indices, known: known.filter(Boolean).length, total: known.length, originM: origin, stepM: step, extentM }
}
