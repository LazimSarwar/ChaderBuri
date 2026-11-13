import { reliefStats, slopeDeg, type HeightSample } from '../lib/overlayMath.ts'
export type GroundZone = { radiusM: number; maxSlopeDeg: number | null; reliefM: number | null; coverage: number; resolutionM: number; interpolated: boolean }
/** Sample at source spacing. Small radii can only describe interpolation of a coarse product. */
export function landingZones(sample: HeightSample | null, resolutionM: number): GroundZone[] {
  return [10, 25, 50].map(radiusM => {
    if (!sample) return { radiusM, maxSlopeDeg: null, reliefM: null, coverage: 0, resolutionM, interpolated: radiusM < resolutionM * 2 }
    const n = Math.max(3, Math.ceil(2 * radiusM / Math.max(1, resolutionM)) + 1), stats = reliefStats(sample, 0, 0, radiusM, n)
    let max: number | null = null
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const e = -radiusM + x * 2 * radiusM / (n - 1), north = -radiusM + y * 2 * radiusM / (n - 1)
      if (Math.hypot(e, north) > radiusM) continue
      const slope = slopeDeg(sample, e, north, Math.max(1, resolutionM))
      if (slope !== null) max = Math.max(max ?? 0, slope)
    }
    return { radiusM, maxSlopeDeg: max, reliefM: stats.known ? stats.max - stats.min : null, coverage: stats.total ? stats.known / stats.total : 0, resolutionM, interpolated: radiusM < resolutionM * 2 }
  })
}
