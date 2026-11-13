import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from '../architect/solver.ts'

export type RankedSite = { slug: string; result: Evaluated; rank: number }
/** Same full mission and equipment at every site. Original catalogue order breaks exact ties. */
export function rankSites(series: SiteSeries[], row: number, c: Constraints): RankedSite[] {
  return series.flatMap((s, order) => row >= 0 && Number.isInteger(row) && row + c.missionDays * 24 <= s.hours
    ? [{ slug: s.slug, result: evaluateWindow(s, row, row + c.missionDays * 24, c), order }] : [])
    .sort((a, b) => Number(b.result.pass) - Number(a.result.pass) || b.result.margin - a.result.margin || a.order - b.order)
    .map(({ slug, result }, i) => ({ slug, result, rank: i + 1 }))
}
export type ArrivalDay = { day: number; row: number | null; margin: number | null }
/** Four evaluated starts per UTC day. A missed day is not proof that all 24 hourly starts fail. */
export function calendarDays(s: SiteSeries, c: Constraints, loDay: number, hiDay: number): ArrivalDay[] {
  const days: ArrivalDay[] = []
  for (let day = loDay; day <= hiDay; day++) {
    let best: { row: number; margin: number } | null = null
    for (let hour = 0; hour < 24; hour += 6) {
      const row = day * 24 + hour
      if (row < 0 || row + c.missionDays * 24 > s.hours) continue
      const result = evaluateWindow(s, row, row + c.missionDays * 24, c)
      if (result.pass && (!best || result.margin > best.margin)) best = { row, margin: result.margin }
    }
    days.push({ day, row: best?.row ?? null, margin: best?.margin ?? null })
  }
  return days
}
export function nowRow(nowMs: number, startMs: number, samples: number): number | null {
  const row = (nowMs - startMs) / 3600000
  return Number.isFinite(row) && row >= 0 && row <= samples - 1 ? row : null
}
