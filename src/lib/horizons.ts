/** Live client for the JPL Horizons API — same service, parameters and
 *  az/el conventions as scripts/fetch_ephemeris.py, but queried on demand
 *  from the browser (through a same-origin pass-through; Horizons sends no
 *  CORS headers). This is what lets Chader Buri check its cached numbers
 *  against NASA's live service, and observe any epoch — past or future —
 *  without shipping more data files. */

export type LiveRow = { t: string; az: number; el: number; radiusDeg?: number; rangeKm?: number }

const endpoint = '/api/horizons'

export type ObserverQuery = {
  heightKm?: number
  target: 'sun' | 'earth'
  /** geodetic latitude, degrees */
  lat: number
  /** east longitude, degrees */
  lonEast: number
  /** 'YYYY-MM-DD HH:MM' UTC */
  startUTC: string
  stopUTC: string
  /** Horizons STEP_SIZE, default '1h' */
  step?: string
}

const TARGET_CODE = { sun: '10', earth: '399' } as const

function buildUrl(q: ObserverQuery): string {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${TARGET_CODE[q.target]}'`,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: "'coord@301'",
    COORD_TYPE: 'GEODETIC',
    // Horizons site coordinates: east-longitude, latitude, height (km).
    // Normalize longitude into [0, 360) — JS '%' keeps the sign, Python's
    // doesn't, and sites.json stores Shackleton as -137.51.
    SITE_COORD: `'${(((q.lonEast % 360) + 360) % 360).toFixed(4)},${q.lat.toFixed(4)},${(q.heightKm ?? 0).toFixed(6)}'`,
    START_TIME: `'${q.startUTC}'`,
    STOP_TIME: `'${q.stopUTC}'`,
    STEP_SIZE: `'${q.step ?? '1h'}'`,
    QUANTITIES: "'4,13,20'",
    EXTRA_PREC: 'YES',
  })
  return `${endpoint}?${params.toString()}`
}

/** Parse the $$SOE…$$EOE table from a Horizons text ephemeris. Identical
 *  logic to scripts/fetch_ephemeris.py: first two numeric tokens after the
 *  date/time are azimuth and elevation; flag tokens (*, i, t, …) skipped. */
export function parseEphemerisText(text: string): LiveRow[] {
  const rows: LiveRow[] = []
  let inside = false
  for (const line of text.split('\n')) {
    if (line.startsWith('$$SOE')) {
      inside = true
      continue
    }
    if (line.startsWith('$$EOE')) break
    if (!inside) continue
    const tok = line.trim().split(/\s+/)
    if (tok.length < 3) continue
    const nums: number[] = []
    for (const t of tok.slice(2)) {
      const v = Number(t)
      if (Number.isFinite(v)) nums.push(v)
      if (nums.length === 5) break
    }
    if (nums.length >= 2 && nums[0] >= 0 && nums[0] <= 360 && Math.abs(nums[1]) <= 90) rows.push({ t: `${tok[0]} ${tok[1]}`, az: nums[0], el: nums[1], ...(nums.length >= 5 ? { radiusDeg: nums[2] / 7200, rangeKm: nums[3] * 149597870.7 } : {}) })
  }
  return rows
}

export async function fetchObserverEphemeris(q: ObserverQuery): Promise<LiveRow[]> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let lastBody = ''
  let lastProblem = 'unknown error'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(buildUrl(q), { signal: AbortSignal.timeout(18000) })
      // Horizons intermittently answers 429/5xx when busy — worth retrying
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        lastProblem = `service temporarily unavailable (HTTP ${res.status})`
        await sleep(1500 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`)
      const doc = (await res.json()) as { result?: string }
      lastBody = doc.result ?? ''
      const rows = parseEphemerisText(lastBody)
      if (rows.length > 0) return rows
      // a banner page (rate limit / bad span) has no $$SOE section
      lastProblem = 'no data rows in response'
      await sleep(1200)
    } catch (e) {
      lastProblem = String(e)
      await sleep(1500 * (attempt + 1))
    }
  }
  throw new Error(
    `${lastProblem} after 3 attempts — NASA's Horizons service may be busy; try again in a few seconds`,
  )
}

/** Demo mode (?snapshot=1): FieldProbe resolves from a recorded fixture with a
 *  visible badge, so the demo path works with no internet. Off by default —
 *  every query is live unless explicitly opted in. */
export const snapshotMode = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('snapshot') === '1'

let snapshotCache: Promise<{
  entries: { body: string; lat: number; lonEast: number; epochMs: number; row: LiveRow }[]
} | null> | null = null

async function snapshotEntries() {
  snapshotCache ??= fetch('/data/benchmark/fieldprobe-snapshot.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return snapshotCache
}

/** Convenience: observe one epoch (a one-hour window; the first row is it). */
export async function observeAt(
  target: 'sun' | 'earth',
  lat: number,
  lonEast: number,
  /** 'YYYY-MM-DD HH:MM' UTC */
  epochUTC: string,
  heightKm = 0,
): Promise<LiveRow[]> {
  if (snapshotMode()) {
    const doc = await snapshotEntries()
    const epochMs = Date.parse(epochUTC.replace(' ', 'T') + 'Z')
    const pick = doc?.entries
      .filter((e) => e.body === target && Math.abs(e.lat - lat) < 0.05 && Math.abs(e.lonEast - ((lonEast % 360) + 360) % 360) < 0.05)
      .sort((a, b) => Math.abs(a.epochMs - epochMs) - Math.abs(b.epochMs - epochMs))[0]
    if (pick && Math.abs(pick.epochMs - epochMs) < 86_400_000) return [pick.row]
    throw new Error('No snapshot covers this probe — rerun without ?snapshot=1 for a live query')
  }
  const stop = new Date(Date.parse(epochUTC.replace(' ', 'T') + 'Z') + 3_600_000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stopUTC =
    `${stop.getUTCFullYear()}-${p2(stop.getUTCMonth() + 1)}-${p2(stop.getUTCDate())} ` +
    `${p2(stop.getUTCHours())}:${p2(stop.getUTCMinutes())}`
  return fetchObserverEphemeris({ target, lat, lonEast, heightKm, startUTC: epochUTC, stopUTC, step: '1h' })
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Format a JS date as the 'YYYY-MM-DD HH:MM' UTC string Horizons expects. */
export function horizonsUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  )
}
