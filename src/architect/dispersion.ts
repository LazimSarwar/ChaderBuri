import {
  azElToDir,
  localFrame,
  sitePosition,
  type EphRow,
  type Horizon,
} from '../data.ts'
import {
  buildSeries,
  evaluateWindow,
  type Constraints,
  type Evaluated,
} from './solver.ts'

export type LandingSample = Horizon & { eastM: number; northM: number }
export type DispersionData = {
  version: number
  radiusM: number
  demResolutionM: number
  sampling: string
  samples: LandingSample[]
}
export type DispersionResult = {
  samples: { terrain: LandingSample; result: Evaluated }[]
  passing: number
  verdict: 'ROBUST' | 'MARGINAL' | 'FRAGILE'
}

/** Translate the nominal apparent topocentric vector to a nearby observer.
 * Preserves the cached apparent direction; differential light-time / aberration
 * corrections are not recomputed. This is a local sensitivity approximation,
 * not a separately queried Horizons ephemeris for each offset.
 */
export function offsetSky(
  row: EphRow,
  nominal: Horizon,
  offset: Horizon,
): EphRow {
  if (
    nominal.lat === offset.lat &&
    nominal.lonEast === offset.lonEast &&
    nominal.siteHeightM === offset.siteHeightM
  )
    return row
  if (!row.rangeKm || row.rangeKm <= 0)
    throw new Error('Dispersion needs target range')
  const from = sitePosition(
    nominal.lat,
    nominal.lonEast,
    1737.4 + nominal.siteHeightM / 1000,
  )
  const to = sitePosition(
    offset.lat,
    offset.lonEast,
    1737.4 + offset.siteHeightM / 1000,
  )
  const direction = azElToDir(row.az, row.el, localFrame(from))
  const v = direction.map((d, i) => d * row.rangeKm! + from[i] - to[i])
  const range = Math.hypot(...v)
  const frame = localFrame(to)
  const dot = (axis: number[]) => axis.reduce((sum, d, i) => sum + d * v[i], 0)
  return {
    ...row,
    az:
      ((Math.atan2(dot(frame.east), dot(frame.north)) * 180) / Math.PI + 360) %
      360,
    el:
      (Math.asin(Math.max(-1, Math.min(1, dot(frame.up) / range))) * 180) /
      Math.PI,
    rangeKm: range,
    radiusDeg:
      row.radiusDeg === undefined
        ? undefined
        : (Math.asin(
            (Math.sin((row.radiusDeg * Math.PI) / 180) * row.rangeKm) / range,
          ) *
            180) /
          Math.PI,
  }
}

export function checkDispersion(
  data: DispersionData,
  sun: EphRow[],
  earth: EphRow[],
  start: number,
  c: Constraints,
): DispersionResult {
  const hours = Math.round(c.missionDays * 24)
  if (
    data.samples.length !== 19 ||
    start < 0 ||
    start + hours >= sun.length ||
    earth.length !== sun.length
  )
    throw new Error('Incomplete landing-dispersion data')
  const nominal = data.samples[0]
  const samples = data.samples.map((terrain) => {
    const sky = (rows: EphRow[]) =>
      rows
        .slice(start, start + hours + 1)
        .map((r) => offsetSky(r, nominal, terrain))
    const series = buildSeries('offset', sky(sun), sky(earth), terrain)
    // Footprint pass/fail is visibility + battery only, matching the panel and
    // SCIENCE.md. Thermal survival is excluded here: it is not surfaced per
    // sample, so including it would silently change the X/19 count.
    return { terrain, result: evaluateWindow(series, 0, hours, { ...c, thermal: undefined }) }
  })
  const passing = samples.filter((p) => p.result.pass).length
  return {
    samples,
    passing,
    verdict:
      passing === samples.length
        ? 'ROBUST'
        : passing === 0
          ? 'FRAGILE'
          : 'MARGINAL',
  }
}
