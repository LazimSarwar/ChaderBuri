import type { EphRow, Horizon } from '../data.ts'
import { nextHorizonCrossing } from './attribution.ts'

// Hours until Earth / the Sun next clears the terrain skyline at the landing target.
// The forward scan is cheap but App renders often, so the moment of each crossing is cached per
// site and scene hour; the hours left are always worked out from the current scene time, so the
// countdown keeps moving between hours. A crossing that has already passed is looked up again.
const cache = new Map<string, { earth: number | null; sun: number | null }>()
export function nextRiseHours(slug: string, row: number, sunRows: EphRow[], earthRows: EphRow[], horizon: Horizon, epoch: Date) {
  const key = `${slug}:${Math.floor(row)}:${horizon.profile.length}`, now = epoch.getTime()
  let at = cache.get(key)
  if (!at || (at.earth !== null && at.earth <= now) || (at.sun !== null && at.sun <= now)) {
    const moment = (hours: number | null | undefined) => hours == null ? null : now + hours * 3_600_000
    at = { earth: moment(nextHorizonCrossing(earthRows, epoch, horizon, true)?.hours), sun: moment(nextHorizonCrossing(sunRows, epoch, horizon, true)?.hours) }
    if (cache.size > 200) cache.clear()
    cache.set(key, at)
  }
  const left = (moment: number | null) => moment === null ? null : (moment - now) / 3_600_000
  return { earth: left(at.earth), sun: left(at.sun) }
}
