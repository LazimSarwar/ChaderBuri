import { generationFor, simulatePower, type PowerRun } from '../architect/power.ts'
import { simulateThermal, type ThermalRun } from '../architect/thermal.ts'
import type { Constraints, SiteSeries } from '../architect/solver.ts'
import { longestRunOverlapping } from './attribution.ts'
import { centerVisible, horizonElevation } from './science.ts'

/**
 * One landing's mission, hour by hour, for the shared time cursor: the battery, Sun and Earth
 * charts and the readout table all read the same moment from here. Every value comes from the
 * same models the verdict uses (same power, thermal and visibility calculations), so moving the
 * cursor never shows a number the verdict would disagree with.
 */
type SkyRow = { az: number; el: number }
export type MissionTimeline = {
  row: number; end: number; span: number; c: Constraints
  run: PowerRun | null; thermal: ThermalRun | null; watts: Float64Array | null
  /** Longest darkness and longest time without Earth inside the mission, as absolute [start, end) rows. */
  dark: [number, number] | null; gap: [number, number] | null
  lowest: { row: number; pct: number } | null
  reserveRow: number | null
}

/** Mission-relative hour → mission day 1…N (the final sample sits on the end boundary, still day N). */
export const dayOf = (missionHour: number, days: number) => Math.min(days, Math.floor(Math.max(0, missionHour) / 24) + 1)

export function missionTimeline(series: SiteSeries, row: number, c: Constraints): MissionTimeline {
  const end = Math.min(series.hours, row + c.missionDays * 24), span = end - row
  const thermal = c.thermal && c.power ? simulateThermal(series.solar, row, end, c.thermal, c.power.loadW, true) : null
  const watts = c.power ? generationFor(series.solar, c.power) : null
  const run = c.power && watts ? simulatePower(watts, row, end, c.power, true, thermal?.heaterW) : null
  const low = run?.points.reduce((m, q) => q.socPct < m.socPct ? q : m, run.points[0]) ?? null
  return {
    row, end, span, c, run, thermal, watts,
    dark: longestRunOverlapping(series.darkRuns, row, end), gap: longestRunOverlapping(series.gapRuns, row, end),
    lowest: low ? { row: row + low.hour, pct: low.socPct } : null,
    reserveRow: run?.firstReserveH != null ? row + run.firstReserveH : null,
  }
}

export type BodyAt = { az: number; el: number; skyline: number; clearance: number; visible: boolean }
export type Moment = {
  /** Mission hour 0…span (span is the end of the mission). */
  hour: number; row: number; day: number; ended: boolean
  batteryPct: number | null; reservePct: number | null; belowReserve: boolean
  /** Solar generation and demand during the hour that starts at this moment (null once the mission has ended). */
  solarW: number | null; demandW: number | null; heaterW: number | null
  tempC: number | null; survivalC: number | null
  sun: BodyAt; earth: BodyAt
}

/** The mission at one whole hour. Visibility uses the same centre-above-skyline rule as the hourly series. */
export function momentAt(t: MissionTimeline, sunRows: SkyRow[], earthRows: SkyRow[], horizon: { profile: number[] }, hour: number): Moment {
  const h = Math.max(0, Math.min(t.span, Math.round(hour))), r = t.row + h, ended = h >= t.span
  const body = (rows: SkyRow[]): BodyAt => {
    const s = rows[r], skyline = horizonElevation(horizon.profile, s.az)
    return { az: s.az, el: s.el, skyline, clearance: s.el - skyline, visible: centerVisible(s.el, skyline) }
  }
  const p = t.c.power, battery = t.run ? t.run.points[h].socPct : null
  return {
    hour: h, row: r, day: dayOf(h, t.c.missionDays), ended,
    batteryPct: battery, reservePct: p?.reservePct ?? null, belowReserve: battery !== null && !!p && battery < p.reservePct - 1e-9,
    solarW: t.watts && !ended ? t.watts[r] : null,
    demandW: p && !ended ? p.loadW + (t.thermal?.heaterW[h] ?? 0) : null,
    heaterW: t.thermal && !ended ? t.thermal.heaterW[h] : null,
    tempC: t.thermal ? t.thermal.points[h].tempK - 273.15 : null,
    survivalC: t.c.thermal ? t.c.thermal.survivalK - 273.15 : null,
    sun: body(sunRows), earth: body(earthRows),
  }
}

/** Moments worth jumping to, as whole mission hours. */
export function keyMoments(t: MissionTimeline) {
  const out: { id: string; label: string; hour: number }[] = [{ id: 'landing', label: 'Landing', hour: 0 }]
  if (t.dark) out.push({ id: 'dark', label: 'Longest darkness begins', hour: t.dark[0] - t.row })
  if (t.lowest && t.c.power) out.push({ id: 'low', label: 'Lowest battery', hour: t.lowest.row - t.row })
  if (t.reserveRow !== null) out.push({ id: 'reserve', label: 'Drops below reserve', hour: Math.min(t.span, Math.floor(t.reserveRow - t.row) + 1) })
  if (t.gap) out.push({ id: 'gap', label: 'Longest Earth gap begins', hour: t.gap[0] - t.row })
  out.push({ id: 'end', label: 'Mission end', hour: t.span })
  return out
}

/** Screen-reader text for the cursor position. */
export function momentText(m: Moment, fmt: (row: number) => string) {
  return `${fmt(m.row)}, day ${m.day}${m.batteryPct !== null ? `, battery ${m.batteryPct.toFixed(0)} percent` : ''}, Sun ${m.sun.visible ? 'up' : 'hidden'}, Earth ${m.earth.visible ? 'in view' : 'hidden'}`
}

/** Degrees with a true minus sign; two decimals when two values would otherwise round alike. */
export const deg = (v: number, fine = false) => `${v < 0 && Math.abs(v) >= (fine ? 0.005 : 0.05) ? '−' : ''}${Math.abs(v).toFixed(fine ? 2 : 1)}°`

/** One plain sentence on why a body is visible or hidden, from the measured skyline. */
export function skylineSentence(name: 'The Sun' | 'Earth', b: BodyAt) {
  const it = name === 'The Sun' ? 'it' : 'Earth', fine = Math.abs(b.clearance) < 0.1
  const gap = clearanceGap(b)
  return `${name} is ${deg(b.el, fine)} high at bearing ${b.az.toFixed(0)}°. The skyline in that direction is at ${deg(b.skyline, fine)}, so ${it} is ${b.visible ? `${gap} above the skyline` : `hidden ${gap} below the skyline`}.`
}
/** Height above or below the skyline, as the difference of the two displayed (rounded) angles so the numbers add up on screen. */
export function clearanceGap(b: BodyAt) {
  const fine = Math.abs(b.clearance) < 0.1, k = fine ? 100 : 10
  return deg(Math.abs(Math.round(b.el * k) - Math.round(b.skyline * k)) / k, fine)
}
