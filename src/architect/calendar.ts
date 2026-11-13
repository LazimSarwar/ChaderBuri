// Feasibility calendar: the best landing start for every day in the search
// range, derived from the same series + evaluator the solver uses. No new
// science — one UI over the existing window math.
import { evaluateWindow, type Constraints, type SiteSeries } from './solver'

export type CalendarCell = {
  day: number
  /** highest-margin passing start that day (hour of day), or null when no start passes */
  bestHour: number | null
  /** margin of that start; null when infeasible */
  margin: number | null
}

export type CalendarMonth = {
  label: string
  year: number
  month: number
  /** leading nulls for weekday offset (Mon-first), then one cell per day */
  cells: (CalendarCell | null)[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function buildCalendarMonths(
  startMs: number,
  series: SiteSeries,
  c: Constraints,
  loDay: number,
  hiDay: number,
  missionHours: number,
): CalendarMonth[] {
  const months: CalendarMonth[] = []
  let current: CalendarMonth | null = null
  for (let day = loDay; day <= hiDay; day++) {
    let bestHour: number | null = null
    let bestMargin = -Infinity
    for (let h = 0; h < 24; h++) {
      const row = day * 24 + h
      if (row + missionHours > series.hours) break
      const ev = evaluateWindow(series, row, row + missionHours, c)
      if (ev.pass && ev.margin > bestMargin) {
        bestMargin = ev.margin
        bestHour = h
      }
    }
    const date = new Date(startMs + day * 24 * 3600_000)
    if (!current || current.year !== date.getUTCFullYear() || current.month !== date.getUTCMonth()) {
      // Pad by the weekday of the FIRST RENDERED day of this month (Mon-first).
      // A search that starts mid-month renders from that day, not the 1st, so
      // padding by the 1st would misalign every date in the opening month.
      current = {
        label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        cells: Array.from({ length: (date.getUTCDay() + 6) % 7 }, () => null),
      }
      months.push(current)
    }
    current.cells.push({ day, bestHour, margin: bestHour === null ? null : bestMargin })
  }
  return months
}
