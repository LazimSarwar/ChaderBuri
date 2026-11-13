import type { Constraints, SiteSeries } from '../architect/solver.ts'
import { missionTimeline } from '../lib/missionMoment.ts'
import { buildFailurePreview } from '../lib/failurePreview.ts'
import { evaluateWindow } from '../architect/solver.ts'
import { precomputedElevation, DSN_MASK_DEG, type DsnGeometry } from '../lib/dsn.ts'

export type MissionEvent = { id: string; label: string; row: number; kind: 'sky' | 'battery' | 'thermal' | 'failure' | 'boundary'; note: string }
export const countdown = (eventRow: number, sceneRow: number) => {
  const minutes = Math.ceil(Math.abs(eventRow - sceneRow) * 60), d = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60
  return `${eventRow < sceneRow ? 'ago ' : 'in '}${d ? `${d} d ` : ''}${h ? `${h} h ` : ''}${m} min`
}
export function missionEvents(s: SiteSeries, row: number, c: Constraints) {
  const t = missionTimeline(s, row, c), events: MissionEvent[] = []
  for (const [runs, label] of [[s.litRuns, 'Sunrise'], [s.darkRuns, 'Sunset'], [s.linkRuns, 'Earthrise'], [s.gapRuns, 'Earthset']] as const) {
    for (const [start] of runs) if (start > 0 && start >= row && start < t.end) events.push({ id: `${label}-${start}`, label, row: start, kind: 'sky', note: 'Hourly centre-above-nominal-skyline transition; not an exact disc crossing.' })
  }
  if (t.lowest) events.push({ id: 'lowest', label: 'Lowest battery', row: t.lowest.row, kind: 'battery', note: `${t.lowest.pct.toFixed(1)}% from the selected lander model.` })
  if (t.reserveRow !== null) events.push({ id: 'reserve', label: 'Battery reserve crossing', row: t.reserveRow, kind: 'battery', note: 'Interpolated model threshold; not measured telemetry.' })
  if (t.thermal?.firstFreezeH != null) events.push({ id: 'freeze', label: 'Lander thermal limit', row: row + t.thermal.firstFreezeH, kind: 'thermal', note: 'Selected equipment thermal screening model, not suit or ground temperature.' })
  if (t.thermal && c.thermal) {
    const saturated = t.thermal.points.find(p => p.heaterW >= c.thermal!.heaterMaxW - 1e-8 && p.heaterW > 0)
    if (saturated) events.push({ id: 'heater', label: 'Heater reaches maximum', row: row + saturated.hour, kind: 'thermal', note: 'Maximum assumed heater output; saturation alone does not imply failure.' })
  }
  const failure = buildFailurePreview(s, evaluateWindow(s, row, t.end, c), c)
  if (failure?.eventHour != null) events.push({ id: 'failure', label: failure.title, row: row + failure.eventHour, kind: 'failure', note: failure.explanation })
  events.push({ id: 'end', label: 'Mission ends', row: t.end, kind: 'boundary', note: 'End of the selected mission window.' })
  return { events: events.sort((a, b) => a.row - b.row || a.id.localeCompare(b.id)), battery: t.run?.points.map(p => ({ row: row + p.hour, pct: p.socPct })) ?? [], failure: failure ? { title: failure.title, explanation: failure.explanation } : null }
}
export type MissionComms = { knownHours: number; hours: number; earthPct: number; opportunityPct: number | null; longestGapH: number | null; stations: { name: string; pct: number | null }[] }
export function missionComms(s: SiteSeries, row: number, hours: number, startMs: number, geo: DsnGeometry | null): MissionComms {
  let knownHours = 0, opportunities = 0, gap = 0, longest = 0
  const stations = (geo?.stations ?? []).map(st => ({ name: st.name, count: 0 }))
  for (let i = row; i < row + hours; i++) {
    const earthUp = s.linkPrefix[i + 1] > s.linkPrefix[i]
    const elevations = stations.map(st => precomputedElevation(geo!, st.name, startMs + i * 3600000))
    if (!elevations.length || elevations.some(el => el === null)) { gap = 0; continue }
    knownHours++
    let any = false
    elevations.forEach((el, j) => { if (earthUp && el! >= DSN_MASK_DEG) { stations[j].count++; any = true } })
    if (any) { opportunities++; gap = 0 } else { gap++; longest = Math.max(longest, gap) }
  }
  const complete = knownHours === hours
  return { knownHours, hours, earthPct: 100 * (s.linkPrefix[row + hours] - s.linkPrefix[row]) / hours,
    opportunityPct: complete ? 100 * opportunities / hours : null, longestGapH: complete ? longest : null,
    stations: stations.map(st => ({ name: st.name, pct: complete ? 100 * st.count / hours : null })) }
}
