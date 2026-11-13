// "Next passing arrival": the first later arrival hour whose whole mission meets the chosen requirements.
// It checks every hour, like the calendar, so no eligible arrival hour is skipped (an earlier helper stepped
// six hours at a time). The search range is returned so the interface can state exactly what was searched.
import { evaluateWindow, type Constraints, type SiteSeries } from '../architect/solver.ts'

export const ARRIVAL_SEARCH_DAYS = 90

export type ArrivalSearch = {
  /** First passing arrival row, or null when none passes in the searched range. */
  row: number | null
  /** First and last arrival rows actually checked (inclusive), and how many hourly arrivals that was. */
  fromRow: number
  toRow: number
  checked: number
  /** True when cached coverage ended before the full search window. */
  coverageLimited: boolean
}

export function nextPassingArrival(series: SiteSeries, row: number, c: Constraints, days = ARRIVAL_SEARCH_DAYS): ArrivalSearch {
  const hours = c.missionDays * 24
  const fromRow = Math.floor(row) + 1
  const wanted = Math.floor(row) + days * 24
  const lastPossible = series.hours - hours
  const toRow = Math.min(wanted, lastPossible)
  for (let r = fromRow; r <= toRow; r++) {
    if (evaluateWindow(series, r, r + hours, c).pass) return { row: r, fromRow, toRow: r, checked: r - fromRow + 1, coverageLimited: false }
  }
  return { row: null, fromRow, toRow, checked: Math.max(0, toRow - fromRow + 1), coverageLimited: lastPossible < wanted }
}

/** Plain-language description of the range searched, for notices beside the result. */
export function arrivalSearchText(s: ArrivalSearch, date: (row: number) => string): string {
  if (s.checked <= 0) return 'No later arrival fits inside the cached predictions.'
  const range = `every hourly arrival from ${date(s.fromRow)} to ${date(s.toRow)}`
  return s.row === null
    ? `No passing arrival found: checked ${range}${s.coverageLimited ? ' (cached predictions end there)' : ''}.`
    : `First passing arrival after checking ${range}.`
}
