// Mission Visor readouts. Every value comes from the existing deterministic pipeline and
// carries its unit, its kind (measured / calculated / estimated / illustrative), its source
// and its assumption. No new science lives here — only selection and formatting.
import type { EphRow, Horizon } from '../data.ts'
import { horizonAt } from '../data.ts'
import type { Constraints, SiteSeries } from '../architect/solver.ts'
import { sunVerdict, type SkySample } from './science.ts'
import { nextHorizonCrossing } from './attribution.ts'
import { missionTrace, missionConsequence } from './missionConsequence.ts'
import { dsnPasses, xbLinkBudget, XB_BUDGET_DEFAULTS, DSN_MASK_DEG } from './dsn.ts'
import type { ReadingStatus, ScreenDigestItem, VisorReading } from './contracts.ts'

export type VisorGroupId = 'power' | 'link' | 'environment' | 'clock'
export const VISOR_GROUPS: { id: VisorGroupId; title: string }[] = [
  { id: 'power', title: 'Power system' }, { id: 'link', title: 'Earth link' },
  { id: 'environment', title: 'Environment' }, { id: 'clock', title: 'Mission clock' },
]
export type VisorGroup = { id: VisorGroupId; title: string; headline: VisorReading; details: VisorReading[] }

export type VisorInputs = {
  slug: string
  /** Fractional scene hour. */
  row: number
  /** Scene hour of the simulated touchdown (the reference mission starts at its whole hour). Null before landing. */
  touchdownRow: number | null
  series: SiteSeries | null
  constraints: Constraints
  sun: SkySample
  earth: SkySample
  horizon: Horizon
  sunRows: EphRow[]
  earthRows: EphRow[]
  epoch: Date
}

const GEOMETRY = 'JPL Horizons ephemeris + LOLA terrain horizon'
const FLOW_LABEL: Record<string, string> = { 'solar surplus': 'solar surplus', 'battery supplying deficit': 'on battery', 'unmet demand': 'unmet', balanced: 'balanced' }
const POWER = 'Power model on Horizons Sun + LOLA horizon'

// --- formatting -------------------------------------------------------------------------
export function formatEta(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return 'beyond the cached window'
  if (hours < 1) return 'within the hour'
  return hours >= 48 ? `in ${(hours / 24).toFixed(1)} d` : `in ${Math.round(hours)} h`
}
export function formatRate(kbps: number): { value: string; unit: string } {
  return kbps >= 1000 ? { value: (kbps / 1000).toFixed(1), unit: 'Mbps' } : { value: kbps.toFixed(0), unit: 'kbps' }
}
export function formatMet(hours: number): string {
  const total = Math.max(0, Math.floor(hours * 3600 + 1e-6)), d = Math.floor(total / 86400), h = Math.floor(total / 3600) % 24, m = Math.floor(total / 60) % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return d > 0 ? `T+${d}d ${pad(h)}:${pad(m)}` : `T+${pad(h)}:${pad(m)}`
}
const signed = (deg: number) => `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(1)}`

// --- caches: traces are O(mission hours), crossings O(remaining hours) --------------------
const traces = new Map<string, ReturnType<typeof missionTrace>>()
function trace(series: SiteSeries, slug: string, start: number, c: Constraints) {
  const key = `${slug}|${start}|${JSON.stringify(c)}`
  if (!traces.has(key)) { if (traces.size > 24) traces.clear(); traces.set(key, missionTrace(series, { id: 0, slug, row: start, c })) }
  return traces.get(key) ?? null
}
// Cache the moment of the next crossing (not the hours left), so a countdown keeps counting
// within the scene hour; a crossing that has already passed is looked up again.
const crossings = new Map<string, number | null>()
function crossingHours(kind: string, slug: string, rows: EphRow[], epoch: Date, horizon: Horizon, rising: boolean, row: number) {
  const key = `${kind}|${slug}|${Math.floor(row)}|${rising}|${horizon.profile.length}`, now = epoch.getTime()
  let at = crossings.get(key)
  if (at === undefined || (at !== null && at <= now)) {
    const hours = nextHorizonCrossing(rows, epoch, horizon, rising)?.hours ?? null
    at = hours === null ? null : now + hours * 3_600_000
    if (crossings.size > 400) crossings.clear()
    crossings.set(key, at)
  }
  return at === null ? null : (at - now) / 3_600_000
}

// --- the four instrument groups -----------------------------------------------------------
export function powerGroup(i: VisorInputs): VisorGroup {
  const p = i.constraints.power
  const lander = p ? `Assumed lander: ${p.panelAreaM2} m² array, ${p.loadW} W load, ${(p.capacityWh / 1000).toFixed(0)} kWh battery, ${p.reservePct}% reserve; ${i.constraints.missionDays}-day mission from touchdown` : 'No lander power model is configured'
  const t = p && i.series && i.touchdownRow !== null ? trace(i.series, i.slug, Math.floor(i.touchdownRow), i.constraints) : null
  // The hourly power model starts at the touchdown's whole hour; shift by the sub-hour part so the
  // battery starts full at the moment of touchdown and agrees with the mission clock.
  const start = i.touchdownRow === null ? 0 : Math.floor(i.touchdownRow), now = t ? missionConsequence(t, start + (i.row - i.touchdownRow!)) : null
  const reading = (id: string, label: string, value: string, unit: string, status: ReadingStatus = 'none'): VisorReading =>
    ({ id, label, value, unit, kind: 'calculated', source: POWER, assumption: lander, status })
  if (!now || now.batteryPct === null) {
    const why = i.touchdownRow === null ? 'Awaiting touchdown' : 'Outside the assessed mission window'
    return { id: 'power', title: 'Power system', headline: { ...reading('battery', 'Battery', 'not assessed', ''), assumption: `${why}. ${lander}` }, details: [] }
  }
  const status: ReadingStatus = now.belowReserve ? 'fail' : now.flow === 'solar surplus' || now.flow === 'balanced' ? 'ok' : 'warn'
  return {
    id: 'power', title: 'Power system',
    headline: reading('battery', 'Battery', now.batteryPct.toFixed(1), '%', status),
    details: [
      reading('generation', 'Generation', (now.generationW ?? 0).toFixed(0), 'W', (now.generationW ?? 0) > 0 ? 'ok' : 'warn'),
      reading('load', 'Load', (now.demandW ?? 0).toFixed(0), 'W'),
      reading('flow', 'Energy flow', FLOW_LABEL[now.flow] ?? now.flow, '', status),
      reading('reserve', 'Reserve limit', String(p!.reservePct), '%'),
    ],
  }
}

export function linkGroup(i: VisorInputs): VisorGroup {
  const clearance = i.earth.el - horizonAt(i.horizon, i.earth.az), visible = clearance > 0
  const eta = crossingHours('earth', i.slug, i.earthRows, i.epoch, i.horizon, !visible, i.row)
  const geometry = (id: string, label: string, value: string, unit: string, status: ReadingStatus = 'none'): VisorReading =>
    ({ id, label, value, unit, kind: 'calculated', source: GEOMETRY, assumption: 'Earth centre against the terrain skyline at the landing target', status })
  const details: VisorReading[] = [
    geometry('earth-clearance', 'Earth above skyline', signed(clearance), '°', visible ? 'ok' : 'fail'),
    geometry('earth-eta', visible ? 'Earthset' : 'Earthrise', formatEta(eta), ''),
  ]
  const best = dsnPasses(i.epoch, DSN_MASK_DEG).filter(s => s.ok).sort((a, b) => b.elevDeg - a.elevDeg)[0]
  if (best) details.push({ id: 'station', label: 'DSN station', value: `${best.name} ${best.elevDeg.toFixed(0)}`, unit: '°', kind: 'calculated', source: 'Analytic DSN station geometry', assumption: 'Moon above the station’s 6° mask; not a scheduled pass', status: 'ok' })
  if (!visible) return { id: 'link', title: 'Earth link', headline: { ...geometry('link', 'Earth', 'masked', ''), status: 'fail', assumption: 'Earth is behind the terrain skyline; no direct-to-Earth link from the target' }, details }
  if (!best) return { id: 'link', title: 'Earth link', headline: { ...geometry('link', 'Earth', 'visible · no station', ''), status: 'warn', assumption: `Earth is above the skyline but no DSN complex has the Moon above ${DSN_MASK_DEG}°` }, details }
  const rangeKm = i.earth.rangeKm ?? 384400
  const budget = xbLinkBudget(rangeKm, best.elevDeg, XB_BUDGET_DEFAULTS.gtDbK34m, 1), rate = formatRate(budget.maxDataRateKbps)
  return {
    id: 'link', title: 'Earth link',
    headline: { id: 'link', label: 'Estimated link opportunity', value: rate.value, unit: rate.unit, kind: 'estimated', source: 'X-band link budget (DSN 810-005 module 206E)', assumption: `34 m antenna at ${best.name}, assumed ${XB_BUDGET_DEFAULTS.landerEirpDbm} dBm lander EIRP. An estimate, not an operational DSN pass or booking.`, status: 'ok' },
    details,
  }
}

export function environmentGroup(i: VisorInputs): VisorGroup {
  const skyline = horizonAt(i.horizon, i.sun.az), state = sunVerdict(i.sun.el, skyline, i.sun.radiusDeg), up = state !== 'shadowed'
  const eta = crossingHours('sun', i.slug, i.sunRows, i.epoch, i.horizon, !up, i.row)
  const reading = (id: string, label: string, value: string, unit: string, status: ReadingStatus = 'none'): VisorReading =>
    ({ id, label, value, unit, kind: 'calculated', source: GEOMETRY, assumption: 'Solar disc against the terrain skyline at the landing target; no atmosphere', status })
  const status: ReadingStatus = state === 'lit' ? 'ok' : state === 'grazing' ? 'warn' : 'fail'
  return {
    id: 'environment', title: 'Environment',
    headline: reading('sun-elevation', `Sunlight · ${state}`, signed(i.sun.el), '°', status),
    details: [
      reading('sun-clearance', 'Sun above skyline', signed(i.sun.el - skyline), '°', status),
      reading('sun-azimuth', 'Sun bearing', i.sun.az.toFixed(0), '°'),
      reading('sun-eta', up ? 'Next sunset' : 'Next sunrise', formatEta(eta), ''),
    ],
  }
}

export function clockGroup(i: VisorInputs): VisorGroup {
  const utc = i.epoch.toISOString().slice(0, 16).replace('T', ' ')
  const sim = { kind: 'illustrative' as const, source: 'Scene clock', status: 'none' as const }
  if (i.touchdownRow === null) return { id: 'clock', title: 'Mission clock', headline: { id: 'met', label: 'Since touchdown', value: 'awaiting touchdown', unit: '', ...sim }, details: [{ id: 'utc', label: 'Scene time', value: utc, unit: 'UTC', ...sim }] }
  const elapsed = i.row - i.touchdownRow, day = Math.floor(elapsed / 24) + 1
  return {
    id: 'clock', title: 'Mission clock',
    headline: { id: 'met', label: 'Since touchdown', value: formatMet(elapsed), unit: '', ...sim, assumption: 'Elapsed scene time since the simulated touchdown' },
    details: [
      { id: 'utc', label: 'Scene time', value: utc, unit: 'UTC', ...sim },
      { id: 'mission-day', label: 'Mission day', value: elapsed < 0 ? 'before touchdown' : `${day} of ${i.constraints.missionDays}`, unit: elapsed < 0 ? '' : 'days', ...sim },
    ],
  }
}

export function visorGroups(i: VisorInputs): VisorGroup[] {
  return [powerGroup(i), linkGroup(i), environmentGroup(i), clockGroup(i)]
}

/** What Chader Buri sees when the visitor asks about the visor. */
export function visorDigest(groups: VisorGroup[]): ScreenDigestItem[] {
  return groups.flatMap(g => [g.headline, ...g.details].map(r => ({
    id: `${g.id}.${r.id}`, label: `${g.title}: ${r.label}`, value: r.value, unit: r.unit || undefined,
    status: r.status, source: `${r.kind} · ${r.source}`,
  })))
}
