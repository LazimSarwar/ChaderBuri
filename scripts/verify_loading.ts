import { readFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { strict as assert } from 'node:assert'
import { loadEphemeris } from '../src/data.ts'
const raw = readFileSync('public/data/ephemeris/malapert-massif.sun.json')
const earthRaw = readFileSync('public/data/ephemeris/malapert-massif.earth.json')
const expected = JSON.parse(raw.toString())
const originalFetch = globalThis.fetch
let checks = 0
try {
  for (const serverDecoded of [false, true]) {
    globalThis.fetch = async (url) => { const source = String(url).includes('.earth.') ? earthRaw : raw; return new Response(serverDecoded ? source : gzipSync(source), {
      headers: serverDecoded ? {'content-encoding':'gzip'} : {},
    }) }
    const result = await loadEphemeris('malapert-massif')
    assert.deepEqual(result.sun, expected); assert.deepEqual(result.earth, JSON.parse(earthRaw.toString())); checks += 2
  }
  globalThis.fetch = async (url) => String(url).endsWith('.gz')
    ? new Response('', {status:404}) : new Response(String(url).includes('.earth.') ? earthRaw : raw)
  assert.deepEqual((await loadEphemeris('malapert-massif')).sun, expected); checks++
  globalThis.fetch = async () => new Response('', {status:503})
  await assert.rejects(loadEphemeris('malapert-massif'), /503/); checks++
  globalThis.fetch = async () => new Response('corrupt gzip')
  await assert.rejects(loadEphemeris('malapert-massif')); checks++
} finally { globalThis.fetch = originalFetch }
for (const slug of ['shackleton-rim','shackleton-floor','malapert-massif','polar-high-point','im-1-odysseus-site','de-gerlache-rim','haworth-rim','faustini-rim','nobile-rim'])
  for (const body of ['sun','earth']) {
    const path = `public/data/ephemeris/${slug}.${body}.json`
    assert.deepEqual(gunzipSync(readFileSync(path+'.gz')), readFileSync(path)); checks++
  }
console.log(`Prediction loading checks passed: ${checks}`)
