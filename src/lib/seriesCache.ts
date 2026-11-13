import { buildSeries, type SiteSeries } from '../architect/solver.ts'
import type { Ephemeris, Horizon } from '../data.ts'

/** Hourly lit/link series per site, built once and shared by the mission plan and Compare. */
const cache = new Map<string, { sun: Ephemeris; earth: Ephemeris; horizon: Horizon; series: SiteSeries }>()
export function siteSeries(slug: string, sun: Ephemeris, earth: Ephemeris, horizon: Horizon): SiteSeries {
  const hit = cache.get(slug)
  if (hit && hit.sun === sun && hit.earth === earth && hit.horizon === horizon) return hit.series
  const series = buildSeries(slug, sun.rows, earth.rows, horizon)
  cache.set(slug, { sun, earth, horizon, series })
  return series
}
