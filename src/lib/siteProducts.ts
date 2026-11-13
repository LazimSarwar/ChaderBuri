import type { Duty, Ephemeris, Horizon, Site } from '../data.ts'

const HOUR = 3_600_000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }

export function validateSites(value: unknown): asserts value is Site[] {
  check(Array.isArray(value) && value.length > 0, 'Site catalog must be a nonempty array')
  const slugs = new Set<string>()
  for (const s of value) {
    check(s && text(s.name) && text(s.slug) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug) && !slugs.has(s.slug), 'Invalid or duplicate site identity')
    check(finite(s.lat) && Math.abs(s.lat) <= 90 && finite(s.lonEast) && Math.abs(s.lonEast) <= 360, 'Invalid site coordinates')
    check((s.kind === 'candidate' || s.kind === 'clps') && typeof s.note === 'string' && (s.siteHeightM === undefined || finite(s.siteHeightM)), 'Invalid site attributes')
    slugs.add(s.slug)
  }
}

/** Reject impossible UTC dates instead of silently normalizing them. */
export function sampleEpoch(value: unknown): number {
  if (typeof value !== 'string') return NaN
  const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
  if (!m) return NaN
  const y = +m[1], mon = MONTHS.indexOf(m[2]), day = +m[3], h = +m[4], min = +m[5]
  if (mon < 0 || h > 23 || min > 59) return NaN
  const t = Date.UTC(y, mon, day, h, min), d = new Date(t)
  return d.getUTCFullYear() === y && d.getUTCMonth() === mon && d.getUTCDate() === day ? t : NaN
}

export function validateEphemeris(value: unknown): asserts value is Ephemeris {
  const d = value as Ephemeris | null
  check(d && text(d.site) && (d.target === 'sun' || d.target === 'earth') && d.stepHours === 1, 'Invalid hourly ephemeris metadata')
  check(Array.isArray(d.rows) && d.rows.length >= 2, 'Ephemeris needs at least two boundary samples')
  const start = sampleEpoch(d.rows[0]?.t)
  check(Number.isFinite(start), 'Invalid ephemeris UTC epoch')
  for (let i = 0; i < d.rows.length; i++) {
    const r = d.rows[i]
    check(r && sampleEpoch(r.t) === start + i * HOUR, `Ephemeris sample ${i}: inconsistent hourly UTC grid`)
    check(finite(r.az) && r.az >= 0 && r.az <= 360 && finite(r.el) && Math.abs(r.el) <= 90, `Ephemeris sample ${i}: invalid azimuth/elevation`)
    check(finite(r.rangeKm) && r.rangeKm > 0 && finite(r.radiusDeg) && r.radiusDeg > 0 && r.radiusDeg < 90, `Ephemeris sample ${i}: missing target range/radius`)
  }
  check(Date.parse(d.start) === start && Date.parse(d.stop) === start + (d.rows.length - 1) * HOUR, 'Ephemeris coverage metadata differs from samples')
}

export function validateHorizon(value: unknown): asserts value is Horizon {
  const d = value as Horizon | null
  check(d && text(d.site) && text(d.dem) && text(d.demSource), 'Invalid terrain provenance')
  check(finite(d.lat) && Math.abs(d.lat) <= 90 && finite(d.lonEast) && Math.abs(d.lonEast) <= 360 && finite(d.siteHeightM), 'Invalid terrain observer coordinates')
  check(Array.isArray(d.profile) && d.profile.length === 360 && d.profile.every(n => finite(n) && Math.abs(n) <= 90), 'Terrain horizon needs 360 finite elevations')
  check(finite(d.maxHorizonDeg), 'Missing terrain maximum elevation')
}

export function validateDuty(value: unknown): asserts value is Duty {
  const d = value as Duty | null
  check(d && text(d.site) && text(d.dem) && Number.isInteger(d.hours) && d.hours > 0, 'Invalid duty-cycle metadata')
  for (const key of ['litHours','linkHours','longestLitH','longestDarkH','longestLinkH','longestNoLinkH'] as const)
    check(Number.isInteger(d[key]) && d[key] >= 0 && d[key] <= d.hours, `Invalid duty-cycle ${key}`)
  for (const key of ['litPct','linkPct'] as const) check(finite(d[key]) && d[key] >= 0 && d[key] <= 100, `Invalid duty-cycle ${key}`)
  check(Math.abs(d.litPct - 100 * d.litHours / d.hours) <= 0.11 && Math.abs(d.linkPct - 100 * d.linkHours / d.hours) <= 0.11, 'Duty percentages disagree with interval counts')
  check(sampleEpoch(d.end) - sampleEpoch(d.start) === d.hours * HOUR, 'Duty coverage differs from interval count')
}

export type SiteBundle = { site: Site; eph: Record<'sun' | 'earth', Ephemeris>; horizon: Horizon; duty: Duty }

/** Individually valid products must also describe the same observer and UTC grid. */
export function validateSiteBundle({site, eph, horizon, duty}: SiteBundle): void {
  validateEphemeris(eph.sun); validateEphemeris(eph.earth); validateHorizon(horizon); validateDuty(duty)
  check(eph.sun.target === 'sun' && eph.earth.target === 'earth', 'Sun/Earth target mismatch')
  check(eph.sun.site === site.name && eph.earth.site === site.name && horizon.site === site.name && duty.site === site.slug, `Products belong to a different site: ${site.slug}`)
  check(eph.sun.rows.length === eph.earth.rows.length && eph.sun.rows[0].t === eph.earth.rows[0].t, 'Sun/Earth coverage mismatch')
  check(duty.hours === eph.sun.rows.length - 1 && duty.start === eph.sun.rows[0].t && duty.end === eph.sun.rows.at(-1)!.t && duty.dem === horizon.dem, 'Statistics and terrain/ephemeris coverage differ')
  const lonDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  check(Math.abs(horizon.lat - site.lat) <= 0.00011 && lonDelta(horizon.lonEast, site.lonEast) <= 0.00011, 'Terrain and selected coordinates differ')
  for (const d of [eph.sun, eph.earth]) if (d.provenance) {
    const o = d.provenance.observer
    check(o && finite(o.lat) && finite(o.lonEast) && finite(o.heightKm) && Math.abs(o.lat - horizon.lat) <= 0.00011 && lonDelta(o.lonEast, horizon.lonEast) <= 0.00011 && Math.abs(o.heightKm * 1000 - horizon.siteHeightM) <= 1.1, 'Ephemeris observer differs from terrain observer')
  }
}

/** Keep the most widely supported UTC grid; one outlier must not define coverage. */
export function compatibleSiteBundles(bundles: SiteBundle[]): SiteBundle[] {
  const groups = new Map<string, SiteBundle[]>()
  for (const b of bundles) {
    const key = `${b.eph.sun.rows[0].t}|${b.eph.sun.rows.length}`
    const group = groups.get(key) ?? []; group.push(b); groups.set(key, group)
  }
  return [...groups.values()].sort((a,b) => b.length - a.length)[0] ?? []
}
