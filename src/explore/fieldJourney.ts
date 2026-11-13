// The field journey after arrival: where you are, the activities on offer, sky events to jump to,
// and conclusions written only from values already calculated (ephemeris rows, the measured horizon,
// equipmentAssessment). Pure (no React); checked by verify:field.
import type { EphRow, Horizon } from '../data.ts'
import { nextHorizonCrossing } from '../lib/attribution.ts'
import { MOON_RADIUS_M } from '../lib/visit.ts'
import { distanceText, formatSimUTC, relativeDirectionText, type BodyState } from './fieldMath.ts'

const deg = (v: number) => `${v.toFixed(1)}°`
const watts = (v: number) => `${v.toFixed(1)} W`
const az = (v: number) => `${Math.round(((v % 360) + 360) % 360)}°`

// ---- arrival ------------------------------------------------------------------------------
export type ArrivalFacts = { site: string; pole: string; lander: string; time: string; scale: string }
/** Distance along the surface to the lunar south pole (reference sphere), from the catalogue latitude. */
export const poleDistanceM = (lat: number) => Math.max(0, (90 + Math.max(-90, Math.min(90, lat)))) * Math.PI / 180 * MOON_RADIUS_M
/** One line each: the site, the south pole, the lander, the scene time and the walkable area. */
export function arrivalFacts(i: { siteName: string; lat: number; lonEast: number; heading: number; landerDistanceM: number; landerBearingDeg: number; landerName: string; epoch: Date; radiusM: number }): ArrivalFacts {
  const pole = poleDistanceM(i.lat)
  return {
    site: i.siteName,
    pole: `${(pole / 1000).toFixed(pole < 10_000 ? 1 : 0)} km from the lunar south pole, which lies due south (bearing 180°, ${relativeDirectionText(i.heading, 180)})`,
    lander: `${i.landerName} ${distanceText(i.landerDistanceM)} away, ${relativeDirectionText(i.heading, i.landerBearingDeg)}`,
    time: formatSimUTC(i.epoch),
    scale: `You can walk within ${i.radiusM} m of the landing point`,
  }
}

// ---- activities ---------------------------------------------------------------------------
export type ActivityId = 'earth' | 'sunlight' | 'time' | 'record'
export const ACTIVITIES: { id: ActivityId; title: string; question: string }[] = [
  { id: 'earth', title: 'Find Earth, then test the antenna', question: 'Can an antenna here see Earth?' },
  { id: 'sunlight', title: 'Investigate sunlight', question: 'How much does pointing a panel at the low Sun matter?' },
  { id: 'time', title: 'Compare another time', question: 'What changes at the next sunrise, sunset, earthrise or earthset?' },
  { id: 'record', title: 'Record an observation', question: 'Leave a photo or note, with a marker you can find again.' },
]
export const activityTitle = (id: ActivityId) => ACTIVITIES.find(a => a.id === id)!.title

export type PanelReading = { sceneUTC?: string; watts: number; azDeg: number; tiltDeg: number; sunFraction: number; sunElDeg: number; skylineElDeg: number }
export type SunlightState = { before: PanelReading | null; after: PanelReading | null }
/** A panel reading changes enough to count as "turned": output up at least 1 W, or orientation moved 5°. */
export function panelTurned(before: PanelReading, now: PanelReading) {
  const turn = Math.abs(((now.azDeg - before.azDeg + 540) % 360) - 180)
  return now.watts - before.watts >= 1 || turn >= 5 || Math.abs(now.tiltDeg - before.tiltDeg) >= 5
}
export type SunlightStage = 'deploy' | 'orient' | 'done'
export const sunlightStage = (s: SunlightState): SunlightStage => !s.before ? 'deploy' : !s.after ? 'orient' : 'done'
/** What the panel experiment found, from the two calculated readings. */
export function sunlightConclusion(s: { before: PanelReading; after: PanelReading }) {
  const { before: b, after: a } = s, sun = { el: a.sunElDeg, skylineEl: a.skylineElDeg }
  const change = b.watts > 0.05 ? ` (${(a.watts / b.watts).toFixed(1)}× the first reading)` : ''
  const why = sun.el > sun.skylineEl
    ? `The Sun stood ${deg(sun.el)} above the horizon line, so its light arrives almost sideways: a panel facing it nearly upright catches far more than one lying flat.`
    : `The Sun was behind the measured skyline (${deg(sun.el)} high against a ${deg(sun.skylineEl)} skyline), so no orientation can catch direct light now.`
  return `Facing bearing ${az(b.azDeg)} at ${deg(b.tiltDeg)} tilt, the example panel modelled ${watts(b.watts)}. Turned to bearing ${az(a.azDeg)} at ${deg(a.tiltDeg)} tilt it modelled ${watts(a.watts)}${change}. ${why}`
}
export const SUNLIGHT_SOURCE = 'Calculated: 2 m², 28% example panel; JPL Horizons Sun position, Sun-disc fraction above the LOLA skyline at the landing point, distance and incidence. Instantaneous output, not a mission energy budget.'

// ---- sky events ----------------------------------------------------------------------------
export type FieldEventKind = 'sunrise' | 'sunset' | 'earthrise' | 'earthset'
export type FieldEvent = { kind: FieldEventKind; body: 'sun' | 'earth'; label: string; hours: number; row: number; atUTC: string }
const EVENT_LABEL: Record<FieldEventKind, string> = { sunrise: 'Next sunrise', sunset: 'Next sunset', earthrise: 'Next earthrise', earthset: 'Next earthset' }
/** How far past a crossing a jump lands, so the change is visible (15 minutes). */
export const EVENT_SETTLE_H = 0.25
/**
 * The next rise and set of the Sun's centre and Earth's centre over the measured skyline at the landing point,
 * from the existing crossing helper. Events beyond the loaded rows are left out. Sorted soonest first.
 */
export function fieldEvents(sunRows: EphRow[], earthRows: EphRow[], horizon: Horizon, epoch: Date, row: number, lastRow: number): FieldEvent[] {
  const out: FieldEvent[] = []
  for (const body of ['sun', 'earth'] as const) {
    const rows = body === 'sun' ? sunRows : earthRows
    if (rows.length < 2) continue
    const kindOf = (rising: boolean): FieldEventKind => body === 'sun' ? (rising ? 'sunrise' : 'sunset') : (rising ? 'earthrise' : 'earthset')
    const add = (rising: boolean, hours: number, atUTC: string) => {
      const at = row + hours
      if (at + EVENT_SETTLE_H <= lastRow && !out.some(e => e.kind === kindOf(rising))) out.push({ kind: kindOf(rising), body, label: EVENT_LABEL[kindOf(rising)], hours, row: at, atUTC })
    }
    // The crossing helper returns 0 h for the state the body is already in; the other one comes first.
    const rise = nextHorizonCrossing(rows, epoch, horizon, true), set = nextHorizonCrossing(rows, epoch, horizon, false)
    const first = [rise, set].filter((c): c is NonNullable<typeof c> => !!c && c.hours > 1e-6).sort((a, b) => a.hours - b.hours)[0]
    if (!first) continue
    const firstRising = first === rise
    add(firstRising, first.hours, first.atUTC)
    // Then the opposite crossing after it (a body that is up sets first, then rises again).
    const later = new Date(epoch.getTime() + (first.hours + 0.05) * 3_600_000)
    const second = nextHorizonCrossing(rows, later, horizon, !firstRising)
    if (second && second.hours > 1e-6) add(!firstRising, first.hours + 0.05 + second.hours, second.atUTC)
  }
  return out.sort((a, b) => a.hours - b.hours)
}
/** The scene row a jump to an event lands on. */
export const eventTargetRow = (e: FieldEvent, lastRow: number) => Math.min(lastRow, e.row + EVENT_SETTLE_H)

export type SkySnapshot = { row: number; epoch: Date; sun: { el: number; skylineEl: number; state: BodyState }; earth: { el: number; skylineEl: number; state: BodyState }; panelW: number | null }
const STATE_WORD: Record<BodyState, string> = { above: 'above the skyline', partial: 'partly behind the skyline', below: 'behind the terrain' }
/** Signed degrees with a true minus; two decimals near zero so a fresh crossing does not read as "−0.0°". */
const signedDeg = (v: number, plus = true) => { const a = Math.abs(v), t = a > 0 && a < 0.095 ? a.toFixed(2) : a.toFixed(1); return `${v < 0 && t !== '0.0' && t !== '0.00' ? '−' : plus ? '+' : ''}${t}°` }
const clearance = (b: { el: number; skylineEl: number }) => signedDeg(b.el - b.skylineEl)
function span(hours: number) {
  const a = Math.abs(hours), t = a >= 48 ? `${(a / 24).toFixed(1)} days` : a >= 1 ? `${a.toFixed(1)} hours` : `${Math.round(a * 60)} minutes`
  return `${hours >= 0 ? 'forward' : 'back'} ${t}`
}
/** "What changed" between two moments at the same place, one short line per body plus the panel when it is set up. */
export function whatChanged(before: SkySnapshot, after: SkySnapshot): string[] {
  const lines = [`Time moved ${span(after.row - before.row)}, to ${formatSimUTC(after.epoch)}. You stayed where you were.`]
  for (const [name, b, a] of [['Sun', before.sun, after.sun], ['Earth', before.earth, after.earth]] as const) {
    const moved = b.state === a.state ? `still ${STATE_WORD[a.state]}` : `${STATE_WORD[b.state]} → ${STATE_WORD[a.state]}`
    lines.push(`${name}: ${moved}; clearance ${clearance(b)} → ${clearance(a)} (elevation ${signedDeg(b.el, false)} → ${signedDeg(a.el, false)}).`)
  }
  if (before.panelW !== null && after.panelW !== null) lines.push(`Example panel at the same orientation: ${watts(before.panelW)} → ${watts(after.panelW)}.`)
  return lines
}
export const TIME_SOURCE = 'Calculated at the landing point: hourly JPL Horizons positions against the measured LOLA skyline (centre of each body). Your camera position does not change these values.'

// ---- record --------------------------------------------------------------------------------
export type RecordState = { photoId: string | null; noteId: string | null }
export const recordDone = (r: RecordState) => !!r.photoId || !!r.noteId

// ---- state kept across the dashboard round trip --------------------------------------------
export type JourneyState = { active: ActivityId | null; sunlight: SunlightState; time: { before: SkySnapshot | null; after: SkySnapshot | null; event: FieldEventKind | null }; record: RecordState; done: ActivityId[] }
export const newJourney = (): JourneyState => ({ active: null, sunlight: { before: null, after: null }, time: { before: null, after: null, event: null }, record: { photoId: null, noteId: null }, done: [] })
export const completeActivity = (s: JourneyState, id: ActivityId): JourneyState => s.done.includes(id) ? s : { ...s, done: [...s.done, id] }
/** The activities to suggest next: not yet done, the current one excluded, in the listed order. */
export const nextActivities = (s: JourneyState, earthDone: boolean) => ACTIVITIES.filter(a => a.id !== s.active && !(a.id === 'earth' ? earthDone : s.done.includes(a.id)))

// ---- phone: one expanded information surface at a time ------------------------------------
export type FieldSurface = 'pause' | 'ask' | 'inspect' | 'tool' | 'more' | 'arrival' | 'objective' | 'caption'
const SURFACE_ORDER: FieldSurface[] = ['pause', 'ask', 'more', 'inspect', 'tool', 'arrival', 'objective', 'caption']
/**
 * On a phone only the highest-priority open surface is expanded; the others are compacted or hidden
 * (their state is kept). Wider screens show everything that is open.
 */
export function arrangeSurfaces(open: Partial<Record<FieldSurface, boolean>>, phone: boolean) {
  const list = SURFACE_ORDER.filter(s => open[s])
  if (!phone) return { primary: list[0] ?? null, hidden: [] as FieldSurface[] }
  return { primary: list[0] ?? null, hidden: list.slice(1) }
}

// ---- Chader Buri's context ------------------------------------------------------------------
export type DigestItem = { id: string; label: string; value: string; unit?: string; source?: string; status?: 'ok' | 'warn' | 'fail' }
/** Field journey readouts for her context; every value fits the 80-character digest limit. */
export function journeyDigest(i: { activity: ActivityId | null; activityStep: string | null; panel: { deployed: boolean; watts: number } | null; earthClearDeg: number; sunClearDeg: number; nextEvent: FieldEvent | null; overlay: string; markers: number }): DigestItem[] {
  const cut = (s: string) => s.length <= 80 ? s : s.slice(0, 79) + '…'
  const items: DigestItem[] = [
    { id: 'field-activity', label: 'Field activity', value: cut(i.activity ? `${activityTitle(i.activity)}${i.activityStep ? ` · ${i.activityStep}` : ''}` : 'free exploration') },
    { id: 'field-clearance', label: 'Sun / Earth clearance over measured skyline (landing point)', value: cut(`Sun ${clearance({ el: i.sunClearDeg, skylineEl: 0 })} / Earth ${clearance({ el: i.earthClearDeg, skylineEl: 0 })}`), source: 'calculated' },
  ]
  if (i.panel) items.push({ id: 'field-panel', label: 'Illustrative panel modelled output now', value: i.panel.deployed ? watts(i.panel.watts) : 'panel not set up', source: 'calculated' })
  if (i.nextEvent) items.push({ id: 'field-next-event', label: 'Next sky event at landing point', value: cut(`${i.nextEvent.label}: ${i.nextEvent.atUTC} UTC`), source: 'calculated' })
  if (i.overlay !== 'off') items.push({ id: 'field-overlay', label: 'Terrain overlay shown', value: cut(i.overlay) })
  if (i.markers) items.push({ id: 'field-markers', label: 'Observation markers at this site', value: String(i.markers) })
  return items
}

// ---- display quality ------------------------------------------------------------------------
export type QualityReport = { level: string; auto: boolean; frameMs: number; dpr: number }
export function qualityText(r: QualityReport | null) {
  if (!r) return 'The scene has not reported its level yet.'
  const level = r.level.charAt(0).toUpperCase() + r.level.slice(1)
  return `${r.auto ? 'Auto · ' : ''}${level} now · ${Number.isFinite(r.frameMs) ? `${r.frameMs.toFixed(0)} ms per frame` : 'frame time unknown'} · ${r.dpr.toFixed(2).replace(/\.?0+$/, '')}× pixel ratio`
}

// ---- terrain overlay legend -----------------------------------------------------------------
export type OverlayMode = 'off' | 'contours' | 'slope' | 'elevation'
export const OVERLAY_TEXT: Record<OverlayMode, { label: string; legend: string }> = {
  off: { label: 'Off', legend: 'No overlay on the ground.' },
  contours: { label: 'Contours', legend: 'Lines of equal DEM elevation drawn on the ground around you.' },
  slope: { label: 'Slope', legend: 'Ground tinted by the slope of the rendered DEM facets; individual rocks are not resolved.' },
  elevation: { label: 'Elevation', legend: 'Ground tinted from low to high DEM elevation around you.' },
}
/** "LOLA DEM (source name, 5 m pixels)": the product the scene reported for the terrain under you. */
export function demProductText(source: string | null | undefined, resolutionM: number | null | undefined) {
  const raw = source && source.trim() ? source.trim() : ''
  // A bare product file name ("ldem_85s_20m.img") means little to a visitor: name the instrument with it.
  const name = !raw ? 'LOLA digital elevation model' : /lola/i.test(raw) ? raw : `LRO LOLA DEM (${raw})`
  return `${name}${resolutionM && Number.isFinite(resolutionM) ? `, ${resolutionM} m pixels` : ''}`
}
