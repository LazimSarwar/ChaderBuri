import { DEFAULT_POWER } from './power'
import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from './solver'

const HOUR = 3_600_000

/**
 * The one worked example every surface tells the same way: Malapert Massif,
 * 14 days from 17 October 2026 with the reference lander, against the same
 * mission one week later. Plan's "Load reference scenario", the Explore hook
 * card and the Compare seed all read from here so the numbers never drift.
 */
export const REFERENCE = {
  slug: 'malapert-massif',
  name: 'Malapert Massif',
  startISO: '2026-10-17T00:00:00Z',
  shiftDays: 7,
  constraints: {
    missionDays: 14,
    minLitPct: 60,
    maxDarkH: 72,
    minLinkPct: 60,
    maxGapH: 72,
    power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 },
  } as Constraints,
  hardwareNote:
    'Reference hardware assumptions: 3.08 m² ideal tracking array, 28% efficiency, 1,200 W constant demand, 10 kWh storage, 90% initial charge, 20% reserve, 95% charge/discharge efficiencies. Editable assumptions, not a flown vehicle.',
}

/** Fresh copies so editing one scenario never mutates the shared reference. */
export const referenceConstraints = (): Constraints => ({
  ...REFERENCE.constraints,
  power: REFERENCE.constraints.power ? { ...REFERENCE.constraints.power } : undefined,
})

/** Hour index of the reference start within the cached ephemeris. */
export const referenceRow = (startMs: number) => Math.round((Date.parse(REFERENCE.startISO) - startMs) / HOUR)

export type ReferenceHook = { a: Evaluated; b: Evaluated; rowA: number; rowB: number; hours: number }

/**
 * Evaluate the reference mission and its one-week-later twin with the live
 * solver, so the hook card quotes the data rather than a remembered result.
 * Returns null when the cached data does not cover both windows.
 */
export function referenceHook(series: SiteSeries, startMs: number): ReferenceHook | null {
  const hours = REFERENCE.constraints.missionDays * 24
  const rowA = referenceRow(startMs)
  const rowB = rowA + REFERENCE.shiftDays * 24
  if (rowA < 0 || rowB + hours > series.hours) return null
  const c = referenceConstraints()
  return { a: evaluateWindow(series, rowA, rowA + hours, c), b: evaluateWindow(series, rowB, rowB + hours, c), rowA, rowB, hours }
}

/** One plain-language clause for a verdict: what passed, or what failed first. */
export function verdictClause(ev: Evaluated, c: Constraints): string {
  if (ev.pass) {
    return c.power && ev.power ? `survives — battery never below ${ev.power.minPct.toFixed(0)}%` : 'survives'
  }
  switch (ev.limiting) {
    case 'battery':
      return `fails — battery falls to ${ev.power?.minPct.toFixed(0) ?? '?'}% against a ${c.power?.reservePct ?? '?'}% reserve`
    case 'thermal':
      return 'fails — the lander freezes'
    case 'lit':
      return `fails — only ${ev.litPct.toFixed(0)}% sunlight`
    case 'dark':
      return `fails — ${ev.longestDarkH} h of unbroken darkness`
    case 'link':
      return `fails — Earth visible only ${ev.linkPct.toFixed(0)}% of the time`
    case 'gap':
      return `fails — Earth hidden for ${ev.longestGapH} h`
    default:
      return 'fails'
  }
}
