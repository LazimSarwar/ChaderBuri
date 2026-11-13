// Pure helpers for the field interface: directions, arrival times, clock text and map transforms.
// Everything here reads existing data (ephemeris rows, the measured horizon) and never invents values.
import type { EphRow, Horizon } from '../data.ts'
import { horizonAt, localFrame, sitePosition } from '../data.ts'
import { MOON_RADIUS_M } from '../lib/visit.ts'
import { sampleSky, sunVerdict } from '../lib/science.ts'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** Signed angle in (-180, 180]. */
export function wrap180(deg: number) {
  const w = ((deg + 180) % 360 + 360) % 360 - 180
  return w === -180 ? 180 : w
}
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

/** Compass bearing (0 = north, 90 = east) from one east/north point to another. */
export function bearingFromTo(fromE: number, fromN: number, toE: number, toN: number) {
  return wrap360(Math.atan2(toE - fromE, toN - fromN) * 180 / Math.PI)
}

/** How far to turn from the current heading to face an azimuth: positive = right. */
export const relativeTurn = (heading: number, az: number) => wrap180(az - heading)

/** "38° to your left", "straight ahead", "behind you". */
export function relativeDirectionText(heading: number, az: number) {
  const d = relativeTurn(heading, az), a = Math.round(Math.abs(d))
  if (a <= 5) return 'straight ahead'
  if (a >= 170) return 'behind you'
  return `${a}° to your ${d < 0 ? 'left' : 'right'}`
}

export type BodyState = 'above' | 'partial' | 'below'
/** Sun: the existing disc verdict (lit / grazing / shadowed). Earth: centre above the measured skyline, as the dashboard uses. */
export function bodyState(body: 'sun' | 'earth', el: number, skylineEl: number, radiusDeg?: number): BodyState {
  if (body === 'sun') {
    const v = sunVerdict(el, skylineEl, radiusDeg)
    return v === 'lit' ? 'above' : v === 'grazing' ? 'partial' : 'below'
  }
  return el > skylineEl ? 'above' : 'below'
}

/** Both the Sun's disc and Earth clear the measured horizon at this row (Earth by at least `earthMarginDeg`). */
export function skyClear(sunRows: EphRow[], earthRows: EphRow[], horizon: Horizon, row: number, earthMarginDeg = 0.5) {
  const sun = sampleSky(sunRows, row), earth = sampleSky(earthRows, row)
  return sunVerdict(sun.el, horizonAt(horizon, sun.az), sun.radiusDeg) === 'lit' && earth.el - horizonAt(horizon, earth.az) >= earthMarginDeg
}

/**
 * The first scene time, from `startRow` forward, when the Sun and Earth both stand above the
 * measured horizon and stay there for `holdHours` (so the landing and first steps happen in that light).
 * Searches at most `maxHours` (45 days by default) and returns null when no such time is in range.
 */
export function findArrivalRow(sunRows: EphRow[], earthRows: EphRow[], horizon: Horizon, startRow: number, opts: { maxHours?: number; holdHours?: number; preferSunClearanceDeg?: number } = {}) {
  const last = Math.min(sunRows.length, earthRows.length) - 1
  if (last < 0 || !Number.isFinite(startRow)) return null
  const maxHours = opts.maxHours ?? 45 * 24, hold = Math.max(0, Math.floor(opts.holdHours ?? 3))
  const start = Math.max(0, Math.min(startRow, last)), end = Math.min(last, start + maxHours)
  const sunClearance = (row: number) => { const sun = sampleSky(sunRows, row); return sun.el - horizonAt(horizon, sun.az) }
  const holds = (row: number, minSun: number) => {
    for (let h = 0; h <= hold; h++) { const r = row + h; if (r > last || !skyClear(sunRows, earthRows, horizon, r) || sunClearance(r) < minSun) return false }
    return true
  }
  const search = (minSun: number) => {
    if (holds(start, minSun)) return start
    for (let r = Math.ceil(start); r <= end; r++) if (holds(r, minSun)) return r
    return null
  }
  // Optionally prefer a time when the Sun stands well clear of the skyline (a lit foreground);
  // otherwise fall back to the first time both bodies are merely above it.
  const preferred = opts.preferSunClearanceDeg ? search(opts.preferSunClearanceDeg) : null
  return preferred ?? search(-Infinity)
}

/** "14 Nov 2026 · 12:00 UTC" */
export function formatSimUTC(d: Date) {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
/** "+1 d 4 h", "−3 h", "+0 h"; whole minutes are dropped. */
export function formatOffsetHours(hours: number) {
  if (!Number.isFinite(hours)) return '—'
  const sign = hours < 0 ? '−' : '+', total = Math.round(Math.abs(hours))
  const d = Math.floor(total / 24), h = total % 24
  return d ? `${sign}${d} d ${h} h` : `${sign}${h} h`
}
/** "in 3.4 h", "in 2.1 d" */
export function formatEta(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return 'not within the loaded predictions'
  if (hours < 1) return `in ${Math.max(1, Math.round(hours * 60))} min`
  return hours >= 48 ? `in ${(hours / 24).toFixed(1)} d` : `in ${hours.toFixed(1)} h`
}
export const distanceText = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`

/** Map view in metres east/north of the landing point; the square spans `centre ± halfM`, north up. */
export type MapView = { centreE: number; centreN: number; halfM: number; sizePx: number }
export function mapProject(eastM: number, northM: number, v: MapView) {
  const k = v.sizePx / (2 * v.halfM)
  return { x: (eastM - v.centreE) * k + v.sizePx / 2, y: v.sizePx / 2 - (northM - v.centreN) * k }
}
export function mapUnproject(x: number, y: number, v: MapView) {
  const k = (2 * v.halfM) / v.sizePx
  return { eastM: v.centreE + (x - v.sizePx / 2) * k, northM: v.centreN + (v.sizePx / 2 - y) * k }
}
/** Keeps a point inside a circle around the landing point (the exploration boundary). */
export function clampToRadius(eastM: number, northM: number, radiusM: number) {
  const r = Math.hypot(eastM, northM)
  if (r <= radiusM || r === 0) return { eastM, northM, clamped: false }
  const k = radiusM / r
  return { eastM: eastM * k, northM: northM * k, clamped: true }
}
/** A point `standoffM` short of `to` on the way from `from`, so a guided walk stops beside an object, not inside it. */
export function approachPoint(from: { eastM: number; northM: number }, to: { eastM: number; northM: number }, standoffM: number) {
  const dE = to.eastM - from.eastM, dN = to.northM - from.northM, d = Math.hypot(dE, dN)
  if (d <= standoffM || d === 0) return { eastM: from.eastM, northM: from.northM }
  const k = (d - standoffM) / d
  return { eastM: from.eastM + dE * k, northM: from.northM + dN * k }
}
/** A round scale-bar length near a quarter of the map width. */
export function scaleBarMetres(spanM: number) {
  const target = spanM / 4
  return [5, 10, 20, 25, 50, 100, 200, 250, 500].reduce((best, s) => Math.abs(s - target) < Math.abs(best - target) ? s : best, 50)
}

/** Compass tape ticks within ±halfSpan of the heading; `offset` is degrees from the centre (negative = left). */
export function compassTicks(heading: number, halfSpan = 60, step = 15) {
  const out: { bearing: number; offset: number; label: string | null }[] = []
  const first = Math.ceil((heading - halfSpan) / step) * step
  for (let b = first; b <= heading + halfSpan; b += step) {
    const bearing = wrap360(b)
    out.push({ bearing, offset: b - heading, label: ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[bearing] ?? (bearing % 45 === 0 ? String(bearing) : null) })
  }
  return out
}

/** Metres east/north of a site for a lat/lon nearby (tangent-plane projection; exact to millimetres within the 250 m area). */
export function localOffsetM(site: { lat: number; lonEast: number }, lat: number, lonEast: number) {
  const frame = localFrame(sitePosition(site.lat, site.lonEast, 1)), p = sitePosition(lat, lonEast, 1)
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return { eastM: dot(p, frame.east) * MOON_RADIUS_M, northM: dot(p, frame.north) * MOON_RADIUS_M }
}
