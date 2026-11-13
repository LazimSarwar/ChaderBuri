import { horizonElevation } from './lib/science.ts'
import { validateEphemeris, validateHorizon, validateDuty, validateSites } from './lib/siteProducts.ts'
import { request, requestJson, jsonBody, type RequestOptions } from './lib/request.ts'
import { indexedOptions, type PredictionIndex } from './lib/predictionIndex.ts'
export { centerVisible, solarDiscFraction, availableSunFraction, panelWattsPerM2, sunVerdict, SUN_RADIUS_DEG, EARTH_RADIUS_DEG, angularSep, eclipseFactor } from './lib/science.ts'
export type V3 = [number, number, number]

export type Site = {
  name: string
  slug: string
  lat: number
  lonEast: number
  kind: 'candidate' | 'clps'
  siteHeightM?: number
  snap?: string | null
  note: string
}

/** Terrain horizon mask: elevation of the local terrain silhouette per azimuth. */
export type Horizon = {
  site: string
  lat: number
  lonEast: number
  dem: string
  demSource: string
  siteHeightM: number
  maxHorizonDeg: number
  rayExtentKm?: number
  azimuthStepDeg?: number
  observerHeightAboveGroundM?: number
  samplingConvention?: string
  /** 360 values, index = azimuth in degrees clockwise from north. */
  profile: number[]
}

/** Precomputed illumination / comms duty-cycle stats (scripts/compute_duty_cycle.py). */
export type Duty = {
  site: string
  start: string
  end: string
  hours: number
  litHours: number
  linkHours: number
  litPct: number
  linkPct: number
  longestLitH: number
  longestDarkH: number
  longestLinkH: number
  longestNoLinkH: number
  dem: string
}

export type PayloadKind =
  | 'Volatiles & ice'
  | 'Drill & sampling'
  | 'Seismology'
  | 'Imaging & cameras'
  | 'Laser & reflectors'
  | 'Radio & navigation'
  | 'Space environment'
  | 'Thermal & radiation'
  | 'Surface tech demo'
  | 'Rover & mobility'
  | 'Biology & agriculture'
  | 'Other science'

export type Payload = {
  name: string
  kind: PayloadKind
  purpose: string
  agency: 'NASA' | 'commercial' | 'international'
  sourceUrl?: string
  unconfirmed?: boolean
}

export type Mission = {
  name: string
  provider: string
  status: 'flown' | 'upcoming' | 'partially-flown' | 'cancelled'
  landingUTC: string | null
  /** Announced target region — set for upcoming missions whose site is
   *  public even when the precise landing ellipse is not. */
  target?: string
  /** Public launch window, e.g. "NET 2027". */
  launchWindow?: string
  /** Known launch date (full or partial precision per launchPrecision). */
  launchDate?: string | null
  launchPrecision?: 'day' | 'month' | 'quarter' | 'year' | null
  /** Lander that carried or will carry the payloads. */
  vehicle?: string
  /** "landing-site" = actual touchdown coordinate; "region-centre" = named
   *  feature centre; "approximate" = widely reported but unofficial. */
  coordinateKind?: 'landing-site' | 'region-centre' | 'approximate' | null
  payloadCount?: number | null
  /** A claim we could not verify from two independent sources. */
  unconfirmed?: boolean
  lat: number | null
  lonEast: number | null
  siteSlug: string | null
  sunAtTouchdown: { az: number; el: number } | null
  payloads?: Payload[]
  note: string
  sources: string
  sourceUrls?: string[]
  lastReviewed?: string
}

export type EphRow = { t: string; az: number; el: number; radiusDeg?: number; rangeKm?: number }

/** Delivered a lander to the surface, fully or partially — flown missions. */
export const missionLanded = (m: Mission) => m.status === 'flown' || m.status === 'partially-flown'

export type Ephemeris = {
  site: string
  target: 'sun' | 'earth'
  start: string
  stop: string
  stepHours: number
  provenance?: {
    source: string; retrievedUTC: string; url: string; rawSha256: string
    observer: { lat: number; lonEast: number; heightKm: number }
    frame: string; referenceRadiusKm: number; ephemeris: string; timeScale: string
    observerHeightAboveGroundM: number
  }
  rows: EphRow[]
}

export const MOON_RADIUS = 1

/**
 * Lat/lon (east-positive) to a point on the three.js sphere such that a
 * standard equirectangular texture maps correctly.
 */
export function sitePosition(lat: number, lonEast: number, r = MOON_RADIUS): V3 {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lonEast + 180) * Math.PI) / 180
  return [
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  ]
}

type Frame = { up: V3; north: V3; east: V3 }

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}




function scale(v: V3, s: number): V3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/** Local horizon frame at a surface point: up = radial, north/east tangential. */
export function localFrame(p: V3): Frame {
  // Analytic tangents from the sphere parametrisation
  // (x=-sinφcosθ, y=cosφ, z=sinφsinθ; φ=(90-lat), θ=(lon+180)).
  // Stable at polar sites, where axis-projection north degenerates.
  const r = Math.hypot(p[0], p[1], p[2]) || 1
  const x = p[0] / r
  const y = p[1] / r
  const z = p[2] / r
  const cosφ = y
  const sinφ = Math.sqrt(Math.max(0, 1 - cosφ * cosφ))
  const θ = Math.atan2(z, -x)
  const north: V3 = [cosφ * Math.cos(θ), sinφ, -cosφ * Math.sin(θ)]
  const east: V3 = [Math.sin(θ), 0, Math.cos(θ)]
  return { up: [x, y, z], north, east }
}

/** Site-local azimuth (deg clockwise from north) + elevation (deg) to a world direction. */
export function azElToDir(azDeg: number, elDeg: number, frame: Frame): V3 {
  const az = (azDeg * Math.PI) / 180
  const el = (elDeg * Math.PI) / 180
  return norm(
    add(
      add(scale(frame.up, Math.sin(el)), scale(frame.north, Math.cos(el) * Math.cos(az))),
      scale(frame.east, Math.cos(el) * Math.sin(az)),
    ),
  )
}

export async function loadSites(options:RequestOptions={}): Promise<Site[]> {
  const sites = await requestJson('/data/sites.json',options)
  validateSites(sites)
  return sites
}

// A 200 response is not enough: a static host can answer a missing asset with an
// HTTP-success page or an empty "{}" that parses as JSON. Validate structure and
// finite values before accepting a product, so a malformed site REJECTS and the
// caller (Promise.allSettled) can drop just that site instead of trusting it.
async function fetchPrediction(url: string,options:RequestOptions={}): Promise<unknown> {
  if (typeof DecompressionStream !== 'undefined') {
    const decoded=await request(url+'.gz',async compressed=>{
      if(compressed.status===404)return null
      if(!compressed.ok||!compressed.body)throw new Error(`Ephemeris ${url}: ${compressed.status}`)
      // Servers may mark .gz files as Content-Encoding: gzip. Fetch has already
      // decoded that body; applying DecompressionStream again would fail.
      if (compressed.headers.get('content-encoding')?.includes('gzip'))
        return jsonBody(compressed,options.expectedSha256)
      const stream = compressed.body.pipeThrough(new DecompressionStream('gzip'))
      return jsonBody(new Response(stream),options.expectedSha256)
    },options)
    if(decoded!==null)return decoded
  }
  return requestJson(url,options)
}

async function loadPrediction(url: string,options:RequestOptions={}): Promise<Ephemeris> {
  const d = await fetchPrediction(url,options)
  validateEphemeris(d)
  return d
}

export type ProductLoadOptions={index?:PredictionIndex;signal?:AbortSignal;timeoutMs?:number}
function productOptions(path:string,options:ProductLoadOptions):RequestOptions{return {...(options.index?indexedOptions(options.index,path,options.signal):{signal:options.signal}),timeoutMs:options.timeoutMs}}
export async function loadEphemeris(slug: string,options:ProductLoadOptions={}): Promise<Record<'sun' | 'earth', Ephemeris>> {
  const sunPath=`/data/ephemeris/${slug}.sun.json`,earthPath=`/data/ephemeris/${slug}.earth.json`
  const [sun, earth] = await Promise.all([
    loadPrediction(sunPath,productOptions(sunPath,options)),
    loadPrediction(earthPath,productOptions(earthPath,options)),
  ])
  if (sun.target !== 'sun' || earth.target !== 'earth' || sun.rows.length !== earth.rows.length || sun.rows[0].t !== earth.rows[0].t) throw new Error(`Ephemeris ${slug}: Sun/Earth targets or UTC coverage differ`)
  return { sun, earth }
}

export async function loadHorizon(slug: string,options:ProductLoadOptions={}): Promise<Horizon> {
  const path=`/data/horizons/${slug}.json`,d=await requestJson(path,productOptions(path,options))
  validateHorizon(d)
  return d
}

export async function loadDuty(slug: string,options:ProductLoadOptions={}): Promise<Duty> {
  const path=`/data/dutycycle/${slug}.json`,d=await requestJson(path,productOptions(path,options))
  validateDuty(d)
  return d
}

export const KM_PER_UNIT = 1737.4
export const ANCHOR_SITE = { lat: -89.936, lonEast: 222.4923 }

/** Scene-frame position (in units) for a body observed at az/el with range km. */
export function solarPosition(azDeg: number, elDeg: number, rangeKm: number): V3 {
  const dir = azElToDir(azDeg, elDeg, localFrame(sitePosition(ANCHOR_SITE.lat, ANCHOR_SITE.lonEast)))
  const k = rangeKm / KM_PER_UNIT
  return [dir[0] * k, dir[1] * k, dir[2] * k]
}

export async function loadMissions(options:RequestOptions={}): Promise<Mission[]> {
  const data=await requestJson('/data/missions.json',options)
  if(!Array.isArray(data))throw new Error('Invalid mission catalog')
  return data
}

/** Terrain elevation in the given azimuth direction (deg above local horizontal). */
export function horizonAt(horizon: Horizon | null, azDeg: number): number {
  if (!horizon) return 0
  return horizonElevation(horizon.profile, azDeg)
}

export function formatRowTime(t: string): string {
  // "2026-Nov-14 00:00" -> "14 Nov 2026, 00:00 UT"
  const [d, hm] = t.split(' ')
  const [y, m, day] = d.split('-')
  return `${day} ${m} ${y}, ${hm} UT`
}
