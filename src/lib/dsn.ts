/** DSN-aware Earth-link checks. "Earth above the site's terrain horizon" is
 *  necessary but not sufficient: somebody on Earth must actually be looking
 *  at the Moon. A downlink pass needs a Deep Space Network complex with the
 *  Moon above its local mask (~6° elevation). */

const RAD = Math.PI / 180

const DSN_COMPLEXES = [
  { name: 'Goldstone', lat: 35.4267, lonEast: 243.1105 },
  { name: 'Madrid', lat: 40.4272, lonEast: 356.9114 },
  { name: 'Canberra', lat: -35.4022, lonEast: 148.9819 },
]

export type DsnPass = { name: string; elevDeg: number; ok: boolean }

const julianDay = (d: Date) => d.getTime() / 86_400_000 + 2_440_587.5

/** Low-precision geocentric lunar direction (Astronomical Almanac formula,
 *  ~0.3 deg — ample for a 6 deg station mask). Returns RA/Dec in degrees. */
function moonRaDec(d: Date): { ra: number; dec: number } {
  const T = (julianDay(d) - 2_451_545.0) / 36_525
  const L = 218.316 + 481_267.8813 * T
  const D = 297.8502 + 445_267.1115 * T
  const M = 357.5291 + 35_999.0503 * T
  const Mp = 134.9634 + 477_198.8676 * T
  const F = 93.2721 + 483_202.0175 * T
  const lambda =
    L +
    6.289 * Math.sin(Mp * RAD) +
    1.274 * Math.sin((2 * D - Mp) * RAD) +
    0.658 * Math.sin(2 * D * RAD) +
    0.214 * Math.sin(2 * Mp * RAD) -
    0.186 * Math.sin(M * RAD) -
    0.114 * Math.sin(2 * F * RAD)
  const beta =
    5.128 * Math.sin(F * RAD) +
    0.281 * Math.sin((Mp + F) * RAD) -
    0.28 * Math.sin((2 * D + F) * RAD) -
    0.17 * Math.sin(2 * F * RAD)
  const eps = 23.4393
  const sinB = Math.sin(beta * RAD)
  const cosB = Math.cos(beta * RAD)
  const ra = Math.atan2(
    Math.sin(lambda * RAD) * Math.cos(eps * RAD) - Math.tan(beta * RAD) * Math.sin(eps * RAD),
    Math.cos(lambda * RAD),
  ) / RAD
  const dec = Math.asin(sinB * Math.cos(eps * RAD) + cosB * Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD
  return { ra: ((ra % 360) + 360) % 360, dec }
}

const gmstDeg = (d: Date) => {
  const g = 280.46061837 + 360.98564736629 * (julianDay(d) - 2_451_545.0)
  return ((g % 360) + 360) % 360
}

/** Does a DSN complex see the Moon? Geocentric elevation corrected for
 *  horizontal parallax (the Moon is close — up to 1 deg shift). */
function stationElevation(station: { lat: number; lonEast: number }, d: Date): number {
  const { ra, dec } = moonRaDec(d)
  const H = (gmstDeg(d) + station.lonEast - ra) * RAD
  const geo =
    Math.asin(
      Math.sin(station.lat * RAD) * Math.sin(dec * RAD) +
        Math.cos(station.lat * RAD) * Math.cos(dec * RAD) * Math.cos(H),
    ) / RAD
  // topocentric dip: subtract horizontal parallax scaled by zenith angle
  const parallax = 0.95
  return geo - parallax * Math.cos(geo * RAD)
}

export function dsnPasses(d: Date, maskDeg = 6): DsnPass[] {
  return DSN_COMPLEXES.map((c) => {
    const elevDeg = stationElevation(c, d)
    return { name: c.name, elevDeg, ok: elevDeg >= maskDeg }
  })
}

export const DSN_MASK_DEG = 6

/* ---------- Precomputed SPICE-grade station geometry ----------
   scripts/build_dsn_geometry.py fetches one Horizons observer query per
   complex (ITRF93 station coordinates, DE441) for the cached window and
   stores Float32 elevations. Inside the window the precomputed series is
   authoritative; the analytic formula above remains the fallback outside
   it (e.g. FieldProbe probes at arbitrary epochs). */

export type DsnGeometry = {
  startMs: number
  stepMs: number
  stations: { name: string; elev: Float32Array }[]
}

let geometry: Promise<DsnGeometry | null> | null = null

async function inflate(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if ('DecompressionStream' in globalThis) {
    const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream('gzip'))
    return await new Response(stream).arrayBuffer()
  }
  throw new Error('gzip unsupported in this browser')
}

export function loadDsnGeometry(): Promise<DsnGeometry | null> {
  geometry ??= (async () => {
    try {
      const r = await fetch('/data/dsn/manifest.json')
      if (!r.ok) return null
      const manifest = await r.json()
      const data = await fetch('/data/dsn/elevations.f32.gz')
      if (!data.ok) return null
      const hours = manifest.counts.hours as number
      const expectedBytes = manifest.counts.stations * hours * 4
      const responseBytes = await data.arrayBuffer()
      // Some static hosts attach Content-Encoding: gzip to a .gz asset, so
      // fetch transparently returns the already-decoded bytes. Others return
      // the gzip container unchanged. Accept both delivery behaviours.
      const payload = responseBytes.byteLength === expectedBytes ? responseBytes : await inflate(responseBytes)
      if (payload.byteLength !== expectedBytes) return null
      const stations = manifest.stations.map((s: { name: string }, i: number) => ({
        name: s.name,
        elev: new Float32Array(payload, i * hours * 4, hours),
      }))
      return {
        startMs: Date.parse(manifest.start + 'T00:00:00Z'),
        stepMs: Number(manifest.stepHours) * 3_600_000,
        stations,
      }
    } catch {
      return null
    }
  })()
  return geometry
}

/** Precomputed station elevation at an exact cached timestamp, or null outside
 * coverage or between samples. Timestamp addressing prevents a future site
 * ephemeris window from silently indexing the wrong DSN hour. */
export function precomputedElevation(
  geo: DsnGeometry,
  stationName: string,
  timeMs: number,
): number | null {
  const s = geo.stations.find((x) => x.name === stationName)
  const sample = (timeMs - geo.startMs) / geo.stepMs
  const index = Math.round(sample)
  if (!s || !Number.isFinite(sample) || Math.abs(sample - index) > 1e-7 || index < 0 || index >= s.elev.length) return null
  return s.elev[index]
}

/* ---------- Disclosed X-band link budget ----------
   DSN 810-005 module 206E table 6 gives typical X-band G/T at 45 deg
   elevation and CD=0.50 weather: 54.6 dB/K for an average 34 m BWG and
   61.7 dB/K for a 70 m antenna. G/T already includes antenna/system noise
   and atmosphere at that reference condition; do not subtract atmosphere a
   second time. The elevation adjustment below is a disclosed screening
   approximation, not an official DSN performance curve.

   Module 206E also gives a standard 1.4 MHz X-band telemetry channel. For
   BPSK rate-1/2 coding this model caps information rate at 0.5 bit/s/Hz.
   Lander EIRP, pointing loss, required Eb/N0 and margin remain disclosed
   screening assumptions rather than DSN commitments. */
export const XB_BUDGET_DEFAULTS = {
  frequencyGHz: 8.4, // X-band deep-space downlink
  landerEirpDbm: 60, // ASSUMPTION: small-lander X-band EIRP
  pointingLossDb: 1.5, // ASSUMPTION: combined pointing + implementation loss
  gtDbK34m: 54.6, // 810-005 module 206E table 6, 34 m BWG, 45 deg, CD=0.50
  gtDbK70m: 61.7, // 810-005 module 206E table 6, 70 m, 45 deg, CD=0.50
  gtReferenceElevationDeg: 45,
  requiredEbN0Db: 2.9, // ASSUMPTION: selected BPSK r=1/2 + RS operating point
  implementationMarginDb: 2.0, // ASSUMPTION
  channelBandwidthMHz: 1.4, // 810-005 module 206E standard X-band telemetry channel
  informationBitsPerHz: 0.5, // BPSK at rate-1/2, idealized before framing overhead
  stationMaskDeg: 6,
}

export type XBandBudgetDefaults = typeof XB_BUDGET_DEFAULTS

export type XBandBudgetResult = {
  cn0DbHz: number
  powerLimitedKbps: number
  channelLimitedKbps: number
  maxDataRateKbps: number
  powerMarginDb: number
  feasible: boolean
}

/** C/N0 in dB-Hz for one pass geometry. */
export function carrierToNoiseDensity(
  rangeKm: number,
  stationElevDeg: number,
  gtDbK: number,
  d: XBandBudgetDefaults = XB_BUDGET_DEFAULTS,
): number {
  if (!(rangeKm > 0) || !Number.isFinite(stationElevDeg) || !Number.isFinite(gtDbK))
    throw new Error('Invalid X-band geometry')
  const fspl = 92.45 + 20 * Math.log10(rangeKm) + 20 * Math.log10(d.frequencyGHz)
  const referenceSin = Math.sin(d.gtReferenceElevationDeg * RAD)
  const elevationRatio = Math.max(0.01, Math.sin(stationElevDeg * RAD)) / referenceSin
  const gt = gtDbK + 10 * Math.log10(elevationRatio)
  const eirpDbw = d.landerEirpDbm - 30
  return eirpDbw - d.pointingLossDb - fspl + gt + 228.6
}

/** Link budget at one pass geometry. `maxDataRateKbps` is the lower of the
 * power-limited and configured channel/coding limits. */
export function xbLinkBudget(
  rangeKm: number,
  stationElevDeg: number,
  gtDbK: number,
  requiredKbps: number,
  d: XBandBudgetDefaults = XB_BUDGET_DEFAULTS,
): XBandBudgetResult {
  if (!(requiredKbps > 0)) throw new Error('Required data rate must be positive')
  const cn0 = carrierToNoiseDensity(rangeKm, stationElevDeg, gtDbK, d)
  const powerLimitedKbps = Math.pow(10, (cn0 - d.requiredEbN0Db - d.implementationMarginDb) / 10) / 1000
  const channelLimitedKbps = d.channelBandwidthMHz * 1000 * d.informationBitsPerHz
  const maxDataRateKbps = Math.min(powerLimitedKbps, channelLimitedKbps)
  const powerMarginDb = cn0 - 10 * Math.log10(requiredKbps * 1000) - d.requiredEbN0Db - d.implementationMarginDb
  return {
    cn0DbHz: cn0,
    powerLimitedKbps,
    channelLimitedKbps,
    maxDataRateKbps,
    powerMarginDb,
    feasible: powerMarginDb >= 0 && requiredKbps <= channelLimitedKbps,
  }
}

export function xbMaxDataRateKbps(
  rangeKm: number,
  stationElevDeg: number,
  gtDbK: number,
  d: XBandBudgetDefaults = XB_BUDGET_DEFAULTS,
): number {
  return xbLinkBudget(rangeKm, stationElevDeg, gtDbK, 1, d).maxDataRateKbps
}
