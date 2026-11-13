// Sun and Earth visible together: the hours of a mission when the Sun's centre and Earth's centre are both
// above the measured skyline, from the same hourly flags the solver uses for sunlight and Earth visibility.
// This is geometry only. It is not usable electrical power and not a working radio link.
import type { SiteSeries } from '../architect/solver.ts'

export type JointVisibility = {
  /** Hourly samples in the window, and how many had both bodies visible. */
  hours: number
  both: number
  pct: number
  /** Longest unbroken run of shared hours inside the window, and the row where it starts (null if none). */
  longestH: number
  longestStartRow: number | null
}

export function jointVisibility(series: SiteSeries, start: number, end: number): JointVisibility {
  const from = Math.max(0, Math.floor(start)), to = Math.min(series.hours, Math.floor(end))
  let both = 0, run = 0, runStart = -1, longestH = 0, longestStartRow: number | null = null
  for (let i = from; i < to; i++) {
    const lit = series.litPrefix[i + 1] - series.litPrefix[i], link = series.linkPrefix[i + 1] - series.linkPrefix[i]
    if (lit && link) {
      both++
      if (run === 0) runStart = i
      run++
      if (run > longestH) { longestH = run; longestStartRow = runStart }
    } else run = 0
  }
  const hours = Math.max(0, to - from)
  return { hours, both, pct: hours ? (100 * both) / hours : 0, longestH, longestStartRow }
}
