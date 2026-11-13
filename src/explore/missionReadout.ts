import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from '../architect/solver.ts'

/** Presentation adapter only: all verdicts and energy calculations come from the planner's solver. */
export type MissionReading = {
  slug: string
  row: number
  arrivalUTC: string
  endUTC: string
  observerHeightM: number
  result: Evaluated
  firstDarkUTC: string | null
  firstEarthGapUTC: string | null
}
export function missionReading(series: SiteSeries, startMs: number, row: number, c: Constraints, observerHeightM: number): MissionReading {
  const hours = c.missionDays * 24
  if (!Number.isInteger(row) || !Number.isInteger(hours) || hours <= 0 || row < 0 || row + hours > series.hours)
    throw new Error('The complete mission must fit inside the cached hourly data. Choose another arrival.')
  const utc = (r: number) => new Date(startMs + r * 3600000).toISOString()
  const first = (runs: [number, number][]) => {
    const run = runs.find(([a, b]) => b > row && a < row + hours)
    return run ? utc(Math.max(row, run[0])) : null
  }
  return { slug: series.slug, row, arrivalUTC: utc(row), endUTC: utc(row + hours), observerHeightM,
    result: evaluateWindow(series, row, row + hours, c), firstDarkUTC: first(series.darkRuns), firstEarthGapUTC: first(series.gapRuns) }
}
export const LIMIT_LABEL = { lit: 'Sunlight coverage', dark: 'Longest darkness', link: 'Earth visibility', gap: 'Longest Earth gap', battery: 'Battery reserve', thermal: 'Thermal requirement' } as const
export function arrivalRows(row: number, hours: number, missionHours: number): number[] {
  return [-168, -24, 0, 24, 168].map(d => row + d).filter(r => Number.isInteger(r) && r >= 0 && r + missionHours <= hours)
}
export function utcInput(row: number, startMs: number): string { return new Date(startMs + row * 3600000).toISOString().slice(0, 16) }
export function inputRow(value: string, startMs: number): number | null {
  const ms = Date.parse(value + 'Z'), row = (ms - startMs) / 3600000
  return Number.isFinite(row) && Number.isInteger(row) ? row : null
}
