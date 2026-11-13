import type { RankedSite } from './siteRanking.ts'

/** Planning uses the nearest hourly prediction; the exact scene/first-visit clock stays separate. */
export function missionPlanningRow(row: number | null | undefined): number | null {
  return row != null && Number.isFinite(row) ? Math.round(row) : null
}

/** Presentation only. The mission solver and its end boundary are left unchanged. */
export function missionPhase(row: number, arrival: number | null, days: number | null | undefined) {
  if (arrival === null || !days || ![row, arrival, days].every(Number.isFinite) || days <= 0) return null
  const end = arrival + days * 24
  if (row < arrival) return { state: 'before' as const, label: 'Before planned arrival', outside: true }
  if (row > end) return { state: 'after' as const, label: `After your ${days}-day mission`, outside: true }
  if (row === end) return { state: 'ended' as const, label: `Mission complete · day ${days} of ${days}`, outside: false }
  return { state: 'during' as const, label: `Mission day ${Math.min(days, Math.floor((row - arrival) / 24) + 1)} of ${days}`, outside: false }
}

/** Exact score ties, independent of their displayed rank or rounded percentages. */
export const sameRanking = (a: RankedSite, b: RankedSite) => a.result.pass === b.result.pass && a.result.margin === b.result.margin

/** Show each reachable return time once, even when arrival, mission and previous time coincide. */
export function timeReturnTargets(current: number, visit: number | null, previous: number | null, mission: number | null) {
  const candidates = [{ kind: 'mission' as const, row: mission }, { kind: 'visit' as const, row: visit }, { kind: 'previous' as const, row: previous }]
  const unique: { kind: 'visit' | 'previous' | 'mission'; row: number }[] = []
  for (const { kind, row } of candidates) {
    if (row === null || !Number.isFinite(row) || Math.abs(current - row) < .01 || unique.some(t => Math.abs(t.row - row) < .01)) continue
    unique.push({ kind, row })
  }
  return unique
}

export function comparisonDifferences(a: RankedSite, b: RankedSite, aName: string, bName: string): string[] {
  const rows: [string, number, number, string][] = [
    ['Earth visibility', a.result.linkPct, b.result.linkPct, 'percentage points'],
    ['longest darkness', a.result.longestDarkH, b.result.longestDarkH, 'hours'],
    ['longest Earth gap', a.result.longestGapH, b.result.longestGapH, 'hours'],
    ['sunlight', a.result.litPct, b.result.litPct, 'percentage points'],
    ...(a.result.power && b.result.power ? [['minimum battery', a.result.power.minPct, b.result.power.minPct, 'percentage points'] as [string, number, number, string]] : []),
  ]
  const changed = rows.filter(([, x, y]) => x.toFixed(1) !== y.toFixed(1))
  if (!changed.length) return ['These sites have the same displayed key values.']
  return changed.slice(0, 3).map(([label, x, y, unit]) => {
    const who = x > y ? aName : bName
    return `${who} has ${Math.abs(x - y).toFixed(Math.abs(x - y) < .1 ? 2 : 1)} ${unit} ${label === 'longest darkness' ? 'more darkness in its longest interval' : label === 'longest Earth gap' ? 'more time in its longest interval without Earth in view' : label === 'minimum battery' ? 'higher minimum battery' : `more ${label}`}.`
  })
}
