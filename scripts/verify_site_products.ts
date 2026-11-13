import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compatibleSiteBundles, sampleEpoch, validateDuty, validateEphemeris, validateHorizon, validateSiteBundle, validateSites, type SiteBundle } from '../src/lib/siteProducts.ts'
import type { Site } from '../src/data.ts'
const read = (path: string) => JSON.parse(readFileSync(`public/data/${path}`, 'utf8'))
const sites: Site[] = read('sites.json')
const bundles: SiteBundle[] = sites.map(site => ({site, eph: {sun: read(`ephemeris/${site.slug}.sun.json`), earth: read(`ephemeris/${site.slug}.earth.json`)}, horizon: read(`horizons/${site.slug}.json`), duty: read(`dutycycle/${site.slug}.json`)}))
let checks = 0
validateSites(sites); checks++
for (const bad of [{}, [], [sites[0], sites[0]], [{...sites[0],lat:NaN}], [{...sites[0],slug:'../escape'}]]) {
  assert.throws(() => validateSites(bad)); checks++
}
for (const b of bundles) { validateSiteBundle(b); checks++ }
const b = bundles[0]
for (const bad of [null, {}, {rows: []}]) {
  assert.throws(() => validateEphemeris(bad)); assert.throws(() => validateHorizon(bad)); assert.throws(() => validateDuty(bad)); checks += 3
}
const copy = <T>(x: T): T => structuredClone(x)
for (const mutate of [
  (v: SiteBundle) => { v.eph.sun.rows[1].t = v.eph.sun.rows[0].t },
  (v: SiteBundle) => { v.eph.earth.rows.shift() },
  (v: SiteBundle) => { v.eph.sun.rows[1].rangeKm = undefined },
  (v: SiteBundle) => { v.eph.sun.rows[1].el = NaN },
  (v: SiteBundle) => { v.eph.earth.target = 'sun' },
  (v: SiteBundle) => { v.horizon.lat += 1 },
  (v: SiteBundle) => { v.horizon.profile[0] = Infinity },
  (v: SiteBundle) => { v.duty.hours += 1 },
  (v: SiteBundle) => { v.duty.litPct = 101 },
  (v: SiteBundle) => { v.duty.site = 'another-site' },
]) { const v = copy(b); mutate(v); assert.throws(() => validateSiteBundle(v)); checks++ }
assert.ok(Number.isNaN(sampleEpoch('2026-Feb-30 00:00'))); checks++
const shifted = {...b, eph: {...b.eph, sun: {...b.eph.sun, rows: b.eph.sun.rows.slice(1)}}}
assert.equal(compatibleSiteBundles([shifted, ...bundles]).length, bundles.length); checks++
assert.deepEqual(compatibleSiteBundles([]), []); checks++
console.log(`Site product contracts passed: ${checks} checks across ${sites.length} sites`)
