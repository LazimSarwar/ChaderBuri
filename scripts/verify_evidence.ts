import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AU_KM, eclipseFactor, interpolateAzimuth, sampleSky, solarFluxScale } from '../src/lib/science.ts'
import { generationFor, simulatePower, DEFAULT_POWER } from '../src/architect/power.ts'
import { powerTradeoffs } from '../src/architect/tradeoffs.ts'
import { parseScenario } from '../src/architect/scenario.ts'
import { validatedHorizonsURL, horizonsResponse } from '../server/horizons-policy.ts'
import { parseEphemerisText } from '../src/lib/horizons.ts'

assert.equal(interpolateAzimuth(359, 1, .5), 0)
assert.equal(interpolateAzimuth(1, 359, .5), 0)
assert.equal(sampleSky([{ az: 359, el: 0 }, { az: 1, el: 2 }], .5).el, 1)
assert.equal(solarFluxScale({ az: 0, el: 0, rangeKm: AU_KM * 2 }), .25)
assert.equal(eclipseFactor(0, 0, 0, 0, 1, .5), .75)
const rows = parseEphemerisText('header\n$$SOE\n 2026-Oct-12 00:00 * 359.123456 -0.002000 1800.000 1.000000 0.000\n$$EOE')
assert.equal(rows.length, 1)
assert.equal(rows[0].radiusDeg, .25)
assert.equal(rows[0].rangeKm, AU_KM)

const solar = { azimuth: new Float64Array(10), elevation: new Float64Array(10), fraction: new Float64Array(10) }
const config = { ...DEFAULT_POWER, capacityWh: 1000, loadW: 100, initialPct: 100, reservePct: 20, chargeEfficiencyPct: 100, dischargeEfficiencyPct: 100 }
const limits = powerTradeoffs(solar, 0, 10, config)
assert.equal(limits[0].value, 1250, 'Analytic capacity for 1000 Wh demand with 20% reserve')
assert.equal(limits[1].value, 80, 'Analytic demand ceiling for 800 Wh usable energy')
assert.equal(limits[2].value, null, 'No array can supply energy in complete darkness')
for (const limit of limits) if (limit.value !== null) {
  const c = { ...config, [limit.key]: limit.value }
  assert.ok(simulatePower(generationFor(solar, c), 0, 10, c).pass)
}
assert.ok(powerTradeoffs(solar, 0, 10, { ...config, initialPct: 10 }).every(t => t.value === null))
const constant = { ...solar, fraction: new Float64Array(10).fill(1) }
assert.equal(powerTradeoffs(constant, 0, 10, config)[0].value, 1, 'Return feasible lower bound exactly')

const scenario = { v: 1, constraints: { missionDays: 14, minLitPct: 60, minLinkPct: 60, maxDarkH: 72, maxGapH: 72, power: config }, loDay: 41, hiDay: 131, selection: { slug: 'shackleton-rim', row: 990 } }
assert.deepEqual(parseScenario(JSON.stringify(scenario)), scenario)
assert.equal(parseScenario('{bad'), null)
assert.equal(parseScenario(JSON.stringify({ ...scenario, loDay: -1 })), null)
assert.equal(parseScenario(JSON.stringify({ ...scenario, constraints: { ...scenario.constraints, power: {} } })), null)
assert.equal(parseScenario(JSON.stringify({ ...scenario, constraints: { ...scenario.constraints, missionDays: 1e9 } })), null)

const query = new URLSearchParams({ format: 'json', COMMAND: "'10'", EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@301'", COORD_TYPE: 'GEODETIC', SITE_COORD: "'222.4923,-89.9360,1.25'", START_TIME: "'2026-10-12 00:00'", STOP_TIME: "'2026-10-12 01:00'", STEP_SIZE: "'1h'", QUANTITIES: "'4,13,20'" })
const url = () => '/api/horizons?' + query.toString()
assert.ok(validatedHorizonsURL(url()).startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?'))
for (const [key, value] of [['COMMAND', '499'], ['CENTER', '500@399'], ['STOP_TIME', '2028-01-01 00:00'], ['START_TIME', '2026-02-30 00:00'], ['STEP_SIZE', '1s'], ['SITE_COORD', '0,91,0']]) {
  const previous = query.get(key)!
  query.set(key, value)
  assert.throws(() => validatedHorizonsURL(url()), `Reject ${key}`)
  query.set(key, previous)
}
assert.throws(() => validatedHorizonsURL(url() + '&COMMAND=10'))
assert.throws(() => validatedHorizonsURL(url() + '&url=https://example.com'))
assert.equal((await horizonsResponse(url(), 'POST')).status, 405)
assert.equal((await horizonsResponse('/api/horizons?COMMAND=10')).status, 400)
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ result: 'invalid table' }))
  assert.equal((await horizonsResponse(url())).status, 502)
  globalThis.fetch = async () => new Response(JSON.stringify({ result: '$$SOE\nvalid\n$$EOE' }))
  const response = await horizonsResponse(url())
  assert.equal(response.status, 200)
  assert.ok(JSON.parse(response.body).retrievedUTC)
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.equal((await horizonsResponse(url())).status, 502)
} finally { globalThis.fetch = originalFetch }

const json = (path: string) => JSON.parse(readFileSync(new URL('../public/data/' + path, import.meta.url), 'utf8'))
const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
const epoch = (t: string) => { const [date, time] = t.split(' '); const [y, m, d] = date.split('-'); const [h, min] = time.split(':'); return Date.UTC(+y, months[m], +d, +h, +min) }
let samples = 0
for (const site of json('sites.json')) {
  const h = json(`horizons/${site.slug}.json`)
  assert.equal(h.profile.length, 360)
  assert.ok(h.profile.every(Number.isFinite))
  assert.equal(h.lat, site.lat); assert.equal(h.lonEast, site.lonEast)
  for (const target of ['sun', 'earth']) {
    const doc = json(`ephemeris/${site.slug}.${target}.json`)
    const p = doc.provenance
    assert.equal(doc.rows.length, 20449)
    assert.equal(p.observer.lat, site.lat)
    assert.ok(Math.abs(p.observer.lonEast - (site.lonEast + 360) % 360) < 1e-8)
    assert.ok(Math.abs(p.observer.heightKm * 1000 - h.siteHeightM) < .01)
    assert.match(p.rawSha256, /^[a-f0-9]{64}$/)
    assert.equal(p.observerHeightAboveGroundM, 0)
    let previous = epoch(doc.rows[0].t) - 3600000
    for (const row of doc.rows) {
      const time = epoch(row.t)
      assert.equal(time - previous, 3600000)
      assert.ok(row.az >= 0 && row.az < 360 && Math.abs(row.el) <= 90)
      assert.ok(row.radiusDeg > 0 && row.radiusDeg < 2)
      assert.ok(target === 'sun' ? row.rangeKm > 140e6 && row.rangeKm < 155e6 : row.rangeKm > 340000 && row.rangeKm < 415000)
      previous = time; samples++
    }
  }
}
console.log(`Evidence checks passed: geometry, analytic design limits, scenario schema, proxy boundaries, failure handling, and ${samples.toLocaleString()} source samples across 14 sites. Not an independent terrain-accuracy benchmark.`)
