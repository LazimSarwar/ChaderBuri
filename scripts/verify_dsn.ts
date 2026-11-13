// DSN geometry + link-budget checks. Offline: verifies the precomputed
// station geometry against its manifest and the analytic fallback port,
// and exercises the three-state / link-budget invariants.
// Run: npm run verify:dsn
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import {
  XB_BUDGET_DEFAULTS,
  carrierToNoiseDensity,
  precomputedElevation,
  xbLinkBudget,
  xbMaxDataRateKbps,
  type DsnGeometry,
} from '../src/lib/dsn.ts'
let checks = 0
const track = (ok: boolean, label: string) => { if (!ok) throw new Error('FAILED: ' + label); checks++ }
import crypto from 'node:crypto'

const ROOT = '.'
const manifest = JSON.parse(await (await import('node:fs')).promises.readFile('public/data/dsn/manifest.json', 'utf-8'))

// 1. payload integrity (hash the compressed bytes exactly as shipped)
const compressed = await (await import('node:fs')).promises.readFile('public/data/dsn/elevations.f32.gz')
const sha = crypto.createHash('sha256').update(compressed).digest('hex')
assert.equal(sha, manifest.provenance.payloadSha256, 'payload sha256 matches manifest')
const generator = await (await import('node:fs')).promises.readFile('scripts/build_dsn_geometry.py')
assert.equal(crypto.createHash('sha256').update(generator).digest('hex'), manifest.provenance.generatorSha256, 'generator sha256 matches manifest')
const payload = gunzipSync(compressed)
const hours = manifest.counts.hours
const stations = manifest.stations
assert.equal(payload.byteLength, stations.length * hours * 4, 'payload length = stations x hours x 4')
for (const s of stations) {
  const source = manifest.provenance.perStation?.[s.name]
  track(typeof source === 'string' && source.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?'), `${s.name}: source query preserved`)
}
const elev = (i: number) => new Float32Array(payload.buffer, payload.byteOffset + i * hours * 4, hours)
const geo: DsnGeometry = {
  startMs: Date.parse(manifest.start + 'T00:00:00Z'),
  stepMs: manifest.stepHours * 3_600_000,
  stations: stations.map((s: { name: string }, i: number) => ({ name: s.name, elev: elev(i) })),
}
track(precomputedElevation(geo, stations[0].name, geo.startMs + 11 * geo.stepMs) === elev(0)[11], 'timestamp-addressed geometry returns the exact sample')
track(precomputedElevation(geo, stations[0].name, geo.startMs + 11.5 * geo.stepMs) === null, 'between-sample timestamp is rejected')
track(precomputedElevation(geo, stations[0].name, geo.startMs - geo.stepMs) === null, 'out-of-coverage timestamp is rejected')

// 2. analytic-delta validation recorded and sane (< 1.5 deg at 6 deg mask scale)
for (const s of stations) {
  const v = manifest.validation[s.name]
  track(v.samples >= 100, `${s.name}: enough validation samples`)
  track(v.maxAbsDeltaDeg < 1.5, `${s.name}: analytic delta ${v.maxAbsDeltaDeg} deg within 1.5`)
}
// independent re-derivation of one delta: analytic at a fixed epoch vs stored value
{
  const d = new Date(manifest.start + 'T00:00:00Z')
  d.setUTCHours(d.getUTCHours() + 97 * 11)
  const idx = 97 * 11
  const s = stations[0]
  // port of src/lib/dsn.ts analytic elevation (kept in sync by verify:dsn)
  const RAD = Math.PI / 180
  const jd = d.getTime() / 86_400_000 + 2_440_587.5
  const T = (jd - 2_451_545.0) / 36_525
  const L = 218.316 + 481_267.8813 * T, D = 297.8502 + 445_267.1115 * T
  const M = 357.5291 + 35_999.0503 * T, Mp = 134.9634 + 477_198.8676 * T, F = 93.2721 + 483_202.0175 * T
  const lam = L + 6.289 * Math.sin(Mp * RAD) + 1.274 * Math.sin((2 * D - Mp) * RAD) + 0.658 * Math.sin(2 * D * RAD)
    + 0.214 * Math.sin(2 * Mp * RAD) - 0.186 * Math.sin(M * RAD) - 0.114 * Math.sin(2 * F * RAD)
  const beta = 5.128 * Math.sin(F * RAD) + 0.281 * Math.sin((Mp + F) * RAD) - 0.28 * Math.sin((2 * D + F) * RAD) - 0.17 * Math.sin(2 * F * RAD)
  const eps = 23.4393
  const ra = Math.atan2(Math.sin(lam * RAD) * Math.cos(eps * RAD) - Math.tan(beta * RAD) * Math.sin(eps * RAD), Math.cos(lam * RAD)) / RAD
  const dec = Math.asin(Math.sin(beta * RAD) * Math.cos(eps * RAD) + Math.cos(beta * RAD) * Math.sin(eps * RAD) * Math.sin(lam * RAD)) / RAD
  const g = 280.46061837 + 360.98564736629 * (jd - 2_451_545.0)
  const H = ((((g + s.lonEast - ra) % 360) + 360) % 360) * RAD
  const geo = Math.asin(Math.sin(s.lat * RAD) * Math.sin(dec * RAD) + Math.cos(s.lat * RAD) * Math.cos(dec * RAD) * Math.cos(H)) / RAD
  const analytic = geo - 0.95 * Math.cos(geo * RAD)
  const stored = elev(0)[idx]
  track(Math.abs(stored - analytic) < 1.5, `Goldstone analytic-vs-stored at fixed epoch: ${Math.abs(stored - analytic).toFixed(3)} deg < 1.5`)
  console.log(`   Goldstone fixed-epoch spot check: stored ${stored.toFixed(3)} vs analytic ${analytic.toFixed(3)} deg`)
}

// 3. plausibility: each complex sees the Moon roughly a third of the time
for (let i = 0; i < stations.length; i++) {
  const above = [...elev(i)].filter((e) => e >= 6).length
  const frac = above / hours
  track(frac > 0.2 && frac < 0.5, `${stations[i].name}: above-mask fraction ${frac.toFixed(2)} plausible`)
}

// 4. link-budget invariants use the production functions, with source-bound
// constants from DSN 810-005 module 206E table 6 rather than a mirrored model.
const defaults = XB_BUDGET_DEFAULTS
track(defaults.gtDbK34m === 54.6, '34 m BWG X-band G/T is 54.6 dB/K at the documented reference condition')
track(defaults.gtDbK70m === 61.7, '70 m X-band G/T is 61.7 dB/K at the documented reference condition')
track(defaults.gtReferenceElevationDeg === 45, 'G/T reference elevation is 45 deg')
track(defaults.channelBandwidthMHz === 1.4, 'standard X-band telemetry channel is 1.4 MHz')
track(defaults.informationBitsPerHz === 0.5, 'BPSK rate-1/2 information spectral efficiency is 0.5 bit/s/Hz')
// C/N0 monotonicity: farther is worse, higher is better; 70 m always >= 34 m.
track(carrierToNoiseDensity(400_000, 30, defaults.gtDbK34m) < carrierToNoiseDensity(360_000, 30, defaults.gtDbK34m), 'C/N0 falls with range')
track(carrierToNoiseDensity(380_000, 40, defaults.gtDbK34m) > carrierToNoiseDensity(380_000, 10, defaults.gtDbK34m), 'C/N0 rises with elevation')
track(carrierToNoiseDensity(380_000, 30, defaults.gtDbK70m) > carrierToNoiseDensity(380_000, 30, defaults.gtDbK34m), '70 m outperforms 34 m')
const lunar = xbLinkBudget(384_400, 30, defaults.gtDbK34m, 128)
track(lunar.powerLimitedKbps > lunar.channelLimitedKbps, 'lunar example is channel-limited under the disclosed default EIRP')
track(lunar.maxDataRateKbps === 700, '1.4 MHz BPSK rate-1/2 channel caps supported information rate at 700 kbps')
track(lunar.feasible, '128 kbps target is feasible in the reference lunar pass')
track(!xbLinkBudget(384_400, 30, defaults.gtDbK34m, 800).feasible, '800 kbps target fails the standard-channel limit')
track(xbMaxDataRateKbps(384_400, 30, defaults.gtDbK34m) === 700, 'public maximum-rate helper applies both limits')
console.log(`   Link budget: 34 m lunar pass power limit ${lunar.powerLimitedKbps.toFixed(0)} kbps; channel-capped at ${lunar.maxDataRateKbps.toFixed(0)} kbps`)
track(defaults.stationMaskDeg === 6, 'station mask 6 deg')

console.log(`DSN geometry + budget checks passed: ${checks}`)
